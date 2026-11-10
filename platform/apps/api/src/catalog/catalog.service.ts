import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ListingStatus, Marketplace, MappingStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { parse } from '../common/zod';
import { DispatcherService } from '../connectors/dispatcher.service';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { EntitlementsService } from '../features/entitlements.service';
import type { AuthUser } from '../auth/auth.types';

const MP = z.enum(['AMAZON', 'FLIPKART']);
const rupees = z.number().nonnegative().max(10_000_000).transform((r) => Math.round(r * 100));

/** amazon-new-listings §15 / flipkart-new-listings §16 status vocabulary (ListingStatus enum). */
const LISTING_STATUSES = Object.values(ListingStatus) as [ListingStatus, ...ListingStatus[]];
/** Statuses that assert something the marketplace did — require marketplace evidence. */
const NEEDS_MARKETPLACE_EVIDENCE: ListingStatus[] = ['CATALOG_ID_CREATED', 'ACTIVE', 'SUPPRESSED', 'INACTIVE', 'LISTING_INCOMPLETE'];
const NEEDS_NOTE: ListingStatus[] = ['REJECTED', 'BLOCKED', 'PROCESSING_ERROR', 'DOCUMENTS_PENDING', 'BRAND_APPROVAL_REQUIRED', 'APPROVAL_REQUIRED', 'CANCELLED'];
const CLIENT_LABEL: Partial<Record<ListingStatus, string>> = {
  RESEARCH_NOT_STARTED: 'Submitted', EXISTING_ID_CHECK: 'Checking existing catalog', CONTENT_IN_PROGRESS: 'Content in progress', CONTENT_REVIEW: 'Content review',
  CLIENT_APPROVAL_PENDING: 'Awaiting your approval', SUBMITTED: 'Submitted to marketplace', PROCESSING: 'Marketplace processing', ACTIVE: 'Live', CATALOG_ID_CREATED: 'Catalog ID created',
};

/** existing-catalog-mapping §7 confidence vocabulary (MappingStatus enum). */
const MAPPING_STATUSES = Object.values(MappingStatus) as [MappingStatus, ...MappingStatus[]];

const ProductSchema = z.object({
  name: z.string().trim().min(2).max(300),
  brand: z.string().trim().max(120).optional(),
  category: z.string().trim().max(200).optional(),
  sku: z.string().trim().max(80).optional(),
  hsn: z.string().trim().regex(/^\d{4,8}$/, 'HSN must be 4–8 digits').optional().or(z.literal('').transform(() => undefined)),
  gstRate: z.number().refine((n) => [0, 0.25, 3, 5, 12, 18, 28].includes(n), 'Use a valid GST slab').optional(),
  mrp: rupees.optional(),
  sellingPrice: rupees.optional(),
  specs: z.string().trim().max(5000).optional(),
  variations: z.string().trim().max(2000).optional(),
}).refine((p) => p.mrp === undefined || p.sellingPrice === undefined || p.sellingPrice <= p.mrp, { message: 'Selling price cannot be above MRP', path: ['sellingPrice'] });

@Injectable()
export class CatalogService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly dispatch: DispatcherService,
    private readonly orch: OrchestratorService,
    private readonly ent: EntitlementsService,
  ) {}

  private async orgFor(user: AuthUser, orgId?: string) {
    const id = user.type === 'CUSTOMER' ? user.organizationId! : orgId;
    if (!id) throw new BadRequestException('organizationId is required');
    await this.access.assertOrg(user, id);
    return id;
  }

  // ───────── Onboarding (plan §8) ─────────

  async onboarding(user: AuthUser, orgIdParam?: string) {
    const orgId = await this.orgFor(user, orgIdParam);
    const [org, sub, accounts, docs, manager, owner] = await Promise.all([
      this.db.organization.findUniqueOrThrow({ where: { id: orgId } }),
      this.ent.currentSubscription(orgId),
      this.db.marketplaceAccount.findMany({ where: { organizationId: orgId } }),
      this.db.document.findMany({ where: { organizationId: orgId, deletedAt: null, kind: { in: ['GST_CERT', 'PAN', 'BRAND_AUTH'] } }, select: { kind: true } }),
      this.db.managerAssignment.findFirst({ where: { organizationId: orgId, endedAt: null }, include: { manager: { select: { name: true } } } }),
      this.db.user.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const kinds = new Set(docs.map((d) => d.kind));
    const steps = [
      { key: 'EMAIL', label: 'Verify your email', done: Boolean(owner?.emailVerified), tab: 'settings' },
      { key: 'PLAN', label: 'Activate a plan', done: Boolean(sub), tab: 'billing' },
      { key: 'BUSINESS', label: 'Business details (legal name, category, PAN)', done: Boolean(org.legalName && org.category && (org.pan || org.gstin)), tab: 'settings' },
      { key: 'BILLING', label: 'Billing address and GSTIN/state', done: Boolean(org.address && org.pincode && (org.gstin || org.stateCode)), tab: 'billing' },
      { key: 'MARKETPLACES', label: 'Amazon / Flipkart seller details', done: accounts.length > 0, tab: 'catalog' },
      { key: 'DOCUMENTS', label: org.gstin ? 'Upload GST certificate' : 'Upload PAN card', done: kinds.has(org.gstin ? 'GST_CERT' : 'PAN') || kinds.has('GST_CERT'), tab: 'documents' },
      { key: 'MANAGER', label: manager ? `Manager assigned: ${manager.manager.name}` : 'Manager assignment', done: Boolean(manager), tab: 'chat' },
    ];
    const complete = steps.every((s) => s.done);
    if (complete && !org.onboardedAt) {
      await this.db.organization.update({ where: { id: orgId }, data: { onboardedAt: new Date() } });
      await this.audit.log({ action: 'onboarding.complete', entity: 'Organization', entityId: orgId, organizationId: orgId });
    }
    return { complete, onboardedAt: org.onboardedAt ?? (complete ? new Date() : null), steps };
  }

  // ───────── Marketplace accounts (no passwords, ever) ─────────

  async marketplaces(user: AuthUser, orgIdParam?: string) {
    const orgId = await this.orgFor(user, orgIdParam);
    const rows = await this.db.marketplaceAccount.findMany({ where: { organizationId: orgId }, select: { marketplace: true, hasAccount: true, sellerId: true, storeName: true, contactEmail: true, status: true, verifiedNote: true, lastError: true, lastSyncAt: true, updatedAt: true, credential: { select: { kind: true, lastTestAt: true, lastTestOk: true, lastTestMessage: true } } } });
    // API keys are write-only: only whether they exist and the last test result are returned.
    return (['AMAZON', 'FLIPKART'] as const).map((m) => {
      const r = rows.find((x) => x.marketplace === m);
      if (!r) return { marketplace: m, hasAccount: null, sellerId: null, storeName: null, contactEmail: null, status: 'NOT_PROVIDED', verifiedNote: null, lastError: null, lastSyncAt: null, updatedAt: null, api: null };
      const { credential, ...rest } = r;
      return { ...rest, api: credential ? { connected: Boolean(credential.lastTestOk), testedAt: credential.lastTestAt, message: credential.lastTestMessage } : null };
    });
  }

  async saveMarketplace(user: AuthUser, marketplace: string, input: unknown) {
    const mp = parse(MP, marketplace) as Marketplace;
    // .strict(): a "password" (or any unknown) field is rejected outright — we never accept marketplace passwords.
    const d = parse(z.object({
      hasAccount: z.boolean(),
      sellerId: z.string().trim().max(100).optional(),
      storeName: z.string().trim().max(200).optional(),
      contactEmail: z.string().trim().toLowerCase().email().optional().or(z.literal('').transform(() => undefined)),
    }).strict(), input);
    if (d.hasAccount && !d.storeName && !d.sellerId) throw new BadRequestException('Add your store name or seller ID');
    const orgId = user.organizationId!;
    const before = await this.db.marketplaceAccount.findUnique({ where: { organizationId_marketplace: { organizationId: orgId, marketplace: mp } } });
    const changedIdentity = before && (before.sellerId !== (d.sellerId ?? null) || before.storeName !== (d.storeName ?? null));
    const row = await this.db.marketplaceAccount.upsert({
      where: { organizationId_marketplace: { organizationId: orgId, marketplace: mp } },
      create: { organizationId: orgId, marketplace: mp, ...d, status: 'PENDING' },
      // Changing the account identity resets verification — SOLLUNA must re-confirm access.
      update: { ...d, sellerId: d.sellerId ?? null, storeName: d.storeName ?? null, contactEmail: d.contactEmail ?? null, ...(changedIdentity || !d.hasAccount ? { status: 'PENDING', verifiedNote: null, verifiedById: null } : {}) },
    });
    await this.audit.log({ actor: user, action: 'marketplace.details_update', entity: 'MarketplaceAccount', entityId: row.id, before: before && { sellerId: before.sellerId, storeName: before.storeName, status: before.status }, after: d });
    return row;
  }

  async verifyMarketplace(user: AuthUser, orgId: string, marketplace: string, input: unknown) {
    await this.access.assertOrg(user, orgId);
    const mp = parse(MP, marketplace) as Marketplace;
    const d = parse(z.object({ status: z.enum(['PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED']), note: z.string().trim().max(1000).optional() }), input);
    if (d.status === 'CONNECTED' && (!d.note || d.note.length < 10)) throw new BadRequestException('Describe how access was confirmed in Seller Central / Seller Hub (evidence required)');
    if (d.status === 'ERROR' && !d.note) throw new BadRequestException('Describe the problem for the client');
    const before = await this.db.marketplaceAccount.findUnique({ where: { organizationId_marketplace: { organizationId: orgId, marketplace: mp } } });
    if (!before) throw new NotFoundException('The client has not added details for this marketplace yet');
    const row = await this.db.marketplaceAccount.update({
      where: { id: before.id },
      data: { status: d.status, ...(d.status === 'CONNECTED' ? { verifiedNote: d.note, verifiedById: user.id, lastError: null, lastSyncAt: new Date() } : d.status === 'ERROR' ? { lastError: d.note } : {}) },
    });
    await this.audit.log({ actor: user, action: 'marketplace.status', entity: 'MarketplaceAccount', entityId: row.id, organizationId: orgId, before: { status: before.status }, after: d });
    const name = mp === 'AMAZON' ? 'Amazon' : 'Flipkart';
    await this.dispatch.emit({ type: 'marketplace.status_changed', organizationId: orgId, title: `${name} account: ${d.status.toLowerCase()}`, body: d.status === 'CONNECTED' ? `SOLLUNA has confirmed access to your ${name} seller account.` : d.note ?? `Your ${name} account status changed to ${d.status.toLowerCase()}.` });
    return row;
  }

  // ───────── Products ─────────

  async products(user: AuthUser, orgIdParam?: string) {
    const orgId = await this.orgFor(user, orgIdParam);
    return this.db.product.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, include: { listingRequests: { select: { id: true, marketplace: true, status: true, catalogId: true, liveUrl: true } } } });
  }

  async createProduct(user: AuthUser, input: unknown) {
    const d = parse(ProductSchema, input);
    const orgId = user.organizationId!;
    if (d.sku && (await this.db.product.findFirst({ where: { organizationId: orgId, sku: d.sku } }))) throw new BadRequestException('A product with this SKU already exists');
    const p = await this.db.product.create({ data: this.productData(orgId, d) });
    await this.audit.log({ actor: user, action: 'product.create', entity: 'Product', entityId: p.id });
    return p;
  }

  async updateProduct(user: AuthUser, id: string, input: unknown) {
    const d = parse(ProductSchema, input);
    const p = await this.db.product.findFirst({ where: { id, organizationId: user.organizationId! } });
    if (!p) throw new NotFoundException('Product not found');
    if (d.sku && d.sku !== p.sku && (await this.db.product.findFirst({ where: { organizationId: p.organizationId, sku: d.sku } }))) throw new BadRequestException('A product with this SKU already exists');
    const live = await this.db.listingRequest.count({ where: { productId: id, status: { in: ['SUBMITTED', 'PROCESSING', 'CATALOG_ID_CREATED', 'ACTIVE'] } } });
    const u = await this.db.product.update({ where: { id }, data: this.productData(p.organizationId, d) });
    await this.audit.log({ actor: user, action: 'product.update', entity: 'Product', entityId: id, before: { name: p.name, mrp: p.mrpPaise, selling: p.sellingPaise }, after: d });
    // Edits after submission are not pushed to the marketplace automatically — a listing change needs a request + approval.
    return { ...u, notice: live ? 'Saved here. Changes to a submitted or live listing are made by SOLLUNA through a listing update request.' : undefined };
  }

  private productData(orgId: string, d: z.infer<typeof ProductSchema>) {
    return {
      organizationId: orgId, name: d.name, brand: d.brand ?? null, category: d.category ?? null, sku: d.sku ?? null, hsn: d.hsn ?? null,
      gstRate: d.gstRate ?? null, mrpPaise: d.mrp ?? null, sellingPaise: d.sellingPrice ?? null,
      specs: d.specs ? { text: d.specs } : Prisma.JsonNull, variations: d.variations ? { text: d.variations } : Prisma.JsonNull,
    };
  }

  // ───────── Listings (Amazon & Flipkart tracked separately) ─────────

  /** Submits one listing request per marketplace through the orchestrator (plan check + quota), then tracks it. */
  async submitListing(user: AuthUser, input: unknown) {
    const d = parse(z.object({ productId: z.string(), marketplaces: z.array(MP).min(1).max(2), notes: z.string().trim().max(2000).optional(), priority: z.enum(['P1', 'P2', 'P3', 'P4']).default('P3') }), input);
    const product = await this.db.product.findFirst({ where: { id: d.productId, organizationId: user.organizationId! } });
    if (!product) throw new NotFoundException('Product not found');
    const missing = [!product.brand && 'brand', !product.category && 'category', product.mrpPaise == null && 'MRP', product.sellingPaise == null && 'selling price', !product.hsn && 'HSN'].filter(Boolean);
    if (missing.length) throw new BadRequestException(`Add ${missing.join(', ')} to the product before requesting a listing`);
    const results = [];
    for (const mp of [...new Set(d.marketplaces)] as Marketplace[]) {
      const open = await this.db.listingRequest.findFirst({ where: { productId: product.id, marketplace: mp, status: { notIn: ['REJECTED', 'CANCELLED'] } } });
      if (open) { results.push({ marketplace: mp, created: false, reason: 'A listing for this product on this marketplace already exists', listingId: open.id }); continue; }
      const featureKey = mp === 'AMAZON' ? 'NEW_LISTING_AMAZON' : 'NEW_LISTING_FLIPKART';
      const { request, update } = await this.orch.intake(user, {
        featureKey, marketplace: mp, priority: d.priority, title: `New ${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'} listing: ${product.name}`,
        details: { productId: product.id, product: product.name, brand: product.brand, sku: product.sku, notes: d.notes },
      });
      if (request.entitlement === 'OUT_OF_PLAN' || request.entitlement === 'LIMIT_REACHED') {
        results.push({ marketplace: mp, created: false, reason: request.entitlement === 'LIMIT_REACHED' ? 'Monthly new-listing limit reached for your plan' : 'Not included in your plan', requestId: request.id, update: update.text });
        continue;
      }
      const listing = await this.db.listingRequest.create({
        data: { organizationId: product.organizationId, productId: product.id, marketplace: mp, serviceRequestId: request.id, payload: { notes: d.notes ?? null }, history: [{ status: 'RESEARCH_NOT_STARTED', note: 'Request submitted', at: new Date().toISOString(), by: user.name }] },
      });
      results.push({ marketplace: mp, created: true, listingId: listing.id, requestId: request.id, entitlement: request.entitlement });
    }
    return { results };
  }

  async listings(user: AuthUser, orgIdParam?: string) {
    const orgId = await this.orgFor(user, orgIdParam);
    const rows = await this.db.listingRequest.findMany({ where: { organizationId: orgId }, orderBy: { updatedAt: 'desc' }, include: { product: { select: { name: true, sku: true, brand: true } } } });
    return rows.map((r) => ({ ...r, statusLabel: CLIENT_LABEL[r.status] ?? r.status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));
  }

  async updateListing(user: AuthUser, id: string, input: unknown) {
    const d = parse(z.object({
      status: z.enum(LISTING_STATUSES),
      note: z.string().trim().max(2000).optional(),
      catalogId: z.string().trim().regex(/^[A-Z0-9]{10,16}$/i, 'ASIN/FSN looks invalid').optional(),
      liveUrl: z.string().trim().url().refine((u) => /^https:\/\/(www\.)?(amazon\.in|flipkart\.com|sellercentral\.amazon\.in|seller\.flipkart\.com)\//.test(u), 'Use the amazon.in / flipkart.com product or seller-portal URL').optional(),
    }), input);
    const l = await this.db.listingRequest.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('Listing not found');
    await this.access.assertOrg(user, l.organizationId);
    const catalogId = d.catalogId ?? l.catalogId;
    const liveUrl = d.liveUrl ?? l.liveUrl;
    if (NEEDS_MARKETPLACE_EVIDENCE.includes(d.status) && !catalogId) throw new BadRequestException('Enter the ASIN/FSN confirmed by the marketplace');
    if (d.status === 'ACTIVE' && !liveUrl) throw new BadRequestException('Live status needs the marketplace product URL as confirmation');
    if (NEEDS_NOTE.includes(d.status) && !d.note) throw new BadRequestException('Add a note explaining this status to the client');
    const history = [...((l.history as unknown[]) ?? []), { status: d.status, note: d.note ?? null, at: new Date().toISOString(), by: user.name }];
    const row = await this.db.listingRequest.update({
      where: { id },
      data: {
        status: d.status, catalogId, liveUrl, history: history as Prisma.InputJsonValue,
        ...(d.status === 'REJECTED' ? { rejectionNote: d.note } : {}),
        countsTowardQuota: l.countsTowardQuota || d.status === 'CATALOG_ID_CREATED' || d.status === 'ACTIVE',
        assigneeId: l.assigneeId ?? user.id,
      },
      include: { product: { select: { name: true } } },
    });
    if (catalogId && (d.status === 'ACTIVE' || d.status === 'CATALOG_ID_CREATED')) {
      await this.db.product.update({ where: { id: l.productId }, data: l.marketplace === 'AMAZON' ? { asin: catalogId } : { fsn: catalogId } });
    }
    await this.audit.log({ actor: user, action: 'listing.status', entity: 'ListingRequest', entityId: id, organizationId: l.organizationId, before: { status: l.status }, after: d });
    const label = CLIENT_LABEL[d.status] ?? d.status.replace(/_/g, ' ').toLowerCase();
    await this.dispatch.emit({ type: 'listing.status_changed', organizationId: l.organizationId, title: `${row.product.name} (${l.marketplace === 'AMAZON' ? 'Amazon' : 'Flipkart'}): ${label}`, body: d.note ?? `Listing status is now ${label}.${d.status === 'ACTIVE' && liveUrl ? ` View: ${liveUrl}` : ''}` });
    return row;
  }

  // ───────── Existing catalog mapping ─────────

  async submitMapping(user: AuthUser, input: unknown) {
    const d = parse(z.object({
      marketplace: MP,
      items: z.array(z.object({ identifier: z.string().trim().min(2).max(200), sellerSku: z.string().trim().max(80).optional(), productName: z.string().trim().max(300).optional() })).min(1).max(500),
    }), input);
    const { request, update } = await this.orch.intake(user, {
      featureKey: 'CATALOG_MAPPING', marketplace: d.marketplace, title: `Catalog mapping: ${d.items.length} product${d.items.length > 1 ? 's' : ''} on ${d.marketplace === 'AMAZON' ? 'Amazon' : 'Flipkart'}`,
      details: { items: d.items.length, sample: d.items.slice(0, 5).map((i) => i.identifier) },
    });
    if (request.entitlement !== 'ALLOWED' && request.entitlement !== 'PENDING_VERIFICATION') return { created: 0, requestId: request.id, update: update.text };
    await this.db.catalogMapping.createMany({
      data: d.items.map((i) => ({ organizationId: user.organizationId!, marketplace: d.marketplace as Marketplace, identifier: i.identifier, sellerSku: i.sellerSku, productInfo: i.productName ? { name: i.productName } : undefined, serviceRequestId: request.id })),
    });
    return { created: d.items.length, requestId: request.id, update: update.text };
  }

  async mappings(user: AuthUser, orgIdParam?: string) {
    const orgId = await this.orgFor(user, orgIdParam);
    return this.db.catalogMapping.findMany({ where: { organizationId: orgId }, orderBy: [{ updatedAt: 'desc' }] });
  }

  async updateMapping(user: AuthUser, id: string, input: unknown) {
    const d = parse(z.object({ status: z.enum(MAPPING_STATUSES), candidateId: z.string().trim().regex(/^[A-Z0-9]{10,16}$/i, 'ASIN/FSN looks invalid').optional(), note: z.string().trim().max(2000).optional() }), input);
    const m = await this.db.catalogMapping.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Mapping not found');
    await this.access.assertOrg(user, m.organizationId);
    if (['EXACT_VERIFIED', 'HIGH_CONFIDENCE', 'CONFLICT'].includes(d.status) && !(d.candidateId ?? m.candidateId)) throw new BadRequestException('Enter the matched ASIN/FSN');
    if (['REVIEW_REQUIRED', 'NO_MATCH_FOUND', 'CONFLICT', 'NOT_ELIGIBLE_OR_BLOCKED'].includes(d.status) && !d.note) throw new BadRequestException('Explain this result to the client');
    const row = await this.db.catalogMapping.update({ where: { id }, data: { status: d.status, candidateId: d.candidateId ?? m.candidateId, note: d.note ?? m.note, assigneeId: user.id, result: { by: user.name, at: new Date().toISOString(), status: d.status } } });
    await this.audit.log({ actor: user, action: 'mapping.update', entity: 'CatalogMapping', entityId: id, organizationId: m.organizationId, before: { status: m.status }, after: d });
    const pending = await this.db.catalogMapping.count({ where: { organizationId: m.organizationId, serviceRequestId: m.serviceRequestId, status: 'NOT_ASSESSED' } });
    if (!pending && m.serviceRequestId) {
      await this.dispatch.emit({ type: 'mapping.updated', organizationId: m.organizationId, title: 'Catalog mapping results ready', body: 'All products in your mapping request have been assessed. Review the results in Catalog → Mapping. High-confidence matches are checked by a SOLLUNA reviewer before upload.' });
    }
    return row;
  }
}
