import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Marketplace, Prisma, StockSeverity } from '@prisma/client';
import { z } from 'zod';
import type { FeatureKey } from '../../../../packages/permissions/src/features';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { parse } from '../common/zod';
import { DispatcherService } from '../connectors/dispatcher.service';
import { EntitlementsService } from '../features/entitlements.service';
import { DocumentsService, type UploadedFile } from '../documents/documents.service';
import type { AuthUser } from '../auth/auth.types';

const MP = z.enum(['AMAZON', 'FLIPKART']);
const mpName = (m: string) => (m === 'AMAZON' ? 'Amazon' : 'Flipkart');
const HEX = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #C9962B');

/**
 * personalized-thank-you-notes §5: wording that buys, steers or pressures reviews, or bypasses marketplace
 * processes, is never printed. This is a guard-rail, not a substitute for the human QA checklist.
 */
const PROHIBITED: [RegExp, string][] = [
  [/\b(5|five)[\s-]*star/i, 'asking for a specific star rating'],
  [/\b(positive|good|great|honest)\s+(review|rating|feedback)/i, 'asking for positive reviews'],
  [/\breview\b[^.]*\b(discount|coupon|cashback|gift|free|refund|reward|voucher|offer)/i, 'offering a benefit for a review'],
  [/\b(discount|coupon|cashback|gift|free|refund|reward|voucher)\b[^.]*\breview/i, 'offering a benefit for a review'],
  [/\b(remove|change|update|delete)\b[^.]*\b(negative\s+)?(review|rating)/i, 'asking to change or remove a review'],
  [/\b(instead of|before)\b[^.]*\b(return|review|complain)/i, 'steering customers away from marketplace returns or reviews'],
  [/\b(whatsapp|call)\b[^.]*\b(instead|directly)\b[^.]*\b(return|refund|amazon|flipkart)/i, 'bypassing the marketplace return/dispute process'],
];
export function noteComplianceIssues(text: string): string[] {
  return [...new Set(PROHIBITED.filter(([re]) => re.test(text)).map(([, why]) => why))];
}

const TemplateSchema = z.object({
  name: z.string().trim().min(2).max(100).default('Thank you note'),
  brandName: z.string().trim().min(1).max(80),
  message: z.string().trim().min(10).max(600),
  supportContact: z.string().trim().max(160).optional(),
  website: z.string().trim().url().refine((u) => u.startsWith('https://'), 'Use an https:// address').optional().or(z.literal('').transform(() => undefined)),
  colors: z.object({ primary: HEX, background: HEX, text: HEX }),
  widthMm: z.number().int().min(50).max(210).default(100),
  heightMm: z.number().int().min(50).max(297).default(150),
  logoDocumentId: z.string().optional(),
});

/** low-stock-alerts §7 defaults (configurable suggestions). */
export function severityFor(sellable: number, avgDailySales: number | null): { severity: StockSeverity | null; daysOfCover: number | null } {
  if (sellable <= 0) return { severity: 'CRITICAL', daysOfCover: 0 };
  if (avgDailySales == null || avgDailySales <= 0) return { severity: null, daysOfCover: null }; // velocity unavailable — never guessed
  const days = sellable / avgDailySales;
  const severity: StockSeverity = days <= 3 ? 'CRITICAL' : days <= 7 ? 'HIGH' : days <= 14 ? 'MEDIUM' : days <= 30 ? 'WATCH' : 'HEALTHY';
  return { severity, daysOfCover: Math.round(days * 10) / 10 };
}
const STALE_HOURS = 48;

@Injectable()
export class FulfilmentService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly dispatch: DispatcherService,
    private readonly ent: EntitlementsService,
    private readonly docs: DocumentsService,
  ) {}

  private async orgFor(user: AuthUser, orgId?: string) {
    const id = user.type === 'CUSTOMER' ? user.organizationId! : orgId;
    if (!id) throw new BadRequestException('organizationId is required');
    await this.access.assertOrg(user, id);
    return id;
  }

  /** Plan check against the client's current subscription (backend-enforced; plan matrix). */
  private async requireFeature(orgId: string, key: FeatureKey, what: string) {
    const r = this.ent.check(await this.ent.context(orgId), key);
    if (!r.allowed) throw new ForbiddenException(r.reason === 'PENDING_VERIFICATION' ? 'Plan is being verified — try again once payment is confirmed' : `${what} is not included in this client's plan`);
  }

  private async hasFeature(orgId: string, key: FeatureKey) {
    return this.ent.check(await this.ent.context(orgId), key).allowed;
  }

  // ───────── Shipping labels (daily-label-processing-delivery) ─────────

  async uploadLabels(user: AuthUser, orgId: string, file: UploadedFile | undefined, input: unknown) {
    await this.access.assertOrg(user, orgId);
    const d = parse(z.object({
      marketplace: MP,
      batchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      orderCount: z.coerce.number().int().min(1).max(5000),
      skippedOrders: z.string().max(5000).optional(), // free text / JSON of duplicates, cancellations, invalid orders
      dispatchBy: z.string().optional(),
      note: z.string().trim().max(1000).optional(),
      includeNotes: z.enum(['true', 'false']).optional(),
    }), input);
    await this.requireFeature(orgId, 'SHIPPING_LABEL_GENERATION', 'Shipping label generation');
    const doc = await this.docs.upload(user, file, { kind: 'LABELS', organizationId: orgId, title: `${mpName(d.marketplace)} labels ${d.batchDate} (${d.orderCount} orders)` });
    if (doc.mimeType !== 'application/pdf') throw new BadRequestException('Labels must be the official marketplace PDF');

    // Premium: approved thank-you note printed as separate inserts — the label PDF itself is never modified.
    let noteTemplateId: string | null = null;
    if (d.includeNotes !== 'false' && (await this.hasFeature(orgId, 'PERSONALIZED_THANK_YOU_NOTES'))) {
      noteTemplateId = (await this.db.thankYouTemplate.findFirst({ where: { organizationId: orgId, status: 'APPROVED', isActive: true }, orderBy: { approvedAt: 'desc' } }))?.id ?? null;
    }
    const job = await this.db.labelJob.create({
      data: {
        organizationId: orgId, marketplace: d.marketplace as Marketplace, batchDate: new Date(`${d.batchDate}T00:00:00Z`), status: 'READY', orderCount: d.orderCount,
        skippedOrders: d.skippedOrders ? { text: d.skippedOrders } : undefined, labelDocumentId: doc.id, noteTemplateId, noteCount: noteTemplateId ? d.orderCount : 0,
        dispatchBy: d.dispatchBy ? new Date(d.dispatchBy) : null, note: d.note, createdById: user.id, startedAt: new Date(), completedAt: new Date(),
      },
    });
    await this.audit.log({ actor: user, action: 'labels.batch_ready', entity: 'LabelJob', entityId: job.id, organizationId: orgId, after: { marketplace: d.marketplace, orders: d.orderCount, notes: job.noteCount, documentId: doc.id } });
    await this.dispatch.emit({
      type: 'labels.ready', organizationId: orgId, title: `${mpName(d.marketplace)} labels ready — ${d.orderCount} orders`,
      body: `Your ${d.batchDate} label batch is ready to print${noteTemplateId ? ` with ${d.orderCount} thank-you note inserts` : ''}.${job.dispatchBy ? ` Dispatch by ${job.dispatchBy.toLocaleString('en-IN')}.` : ''}${d.skippedOrders ? ' Some orders were skipped — see the batch notes.' : ''}`,
    });
    return job;
  }

  async labelJobs(user: AuthUser, orgIdParam?: string) {
    const orgId = await this.orgFor(user, orgIdParam);
    return this.db.labelJob.findMany({ where: { organizationId: orgId }, orderBy: { batchDate: 'desc' }, take: 100 });
  }

  /** Client download of the official label PDF; first download marks the batch delivered. */
  async downloadLabels(user: AuthUser, id: string, ip?: string) {
    const job = await this.db.labelJob.findUnique({ where: { id } });
    if (!job || !job.labelDocumentId || !(await this.access.canAccessOrg(user, job.organizationId))) throw new NotFoundException('Label batch not found');
    const file = await this.docs.download(user, job.labelDocumentId, ip);
    if (user.type === 'CUSTOMER' && !job.downloadedAt) {
      await this.db.labelJob.update({ where: { id }, data: { downloadedAt: new Date(), status: 'DELIVERED' } });
      await this.audit.log({ actor: user, action: 'labels.downloaded', entity: 'LabelJob', entityId: id });
    }
    return file;
  }

  /** Data for the printable thank-you inserts of one batch (rendered by the web app at exact mm size). */
  async batchNotes(user: AuthUser, id: string) {
    const job = await this.db.labelJob.findUnique({ where: { id } });
    if (!job || !(await this.access.canAccessOrg(user, job.organizationId))) throw new NotFoundException('Label batch not found');
    if (!job.noteTemplateId || !job.noteCount) throw new NotFoundException('This batch has no thank-you notes');
    const template = await this.db.thankYouTemplate.findUniqueOrThrow({ where: { id: job.noteTemplateId } });
    return { job: { id: job.id, marketplace: job.marketplace, batchDate: job.batchDate, count: job.noteCount }, template: this.templateView(template) };
  }

  // ───────── Thank-you note templates (Premium) ─────────

  private templateView(t: Prisma.ThankYouTemplateGetPayload<object>) {
    const colors = t.colors as { primary: string; background: string; text: string };
    return { ...t, colors, website: t.qrUrl, logoUrl: t.logoKey ? `/api/documents/${t.logoKey}/download` : null };
  }

  async templates(user: AuthUser, orgIdParam?: string) {
    const orgId = await this.orgFor(user, orgIdParam);
    const premium = await this.hasFeature(orgId, 'CUSTOM_THANK_YOU_DESIGN');
    const rows = await this.db.thankYouTemplate.findMany({ where: { organizationId: orgId, status: { not: 'ARCHIVED' } }, orderBy: { updatedAt: 'desc' } });
    return { included: premium, templates: rows.map((t) => this.templateView(t)) };
  }

  async saveTemplate(user: AuthUser, orgIdParam: string | undefined, id: string | null, input: unknown) {
    const orgId = await this.orgFor(user, orgIdParam);
    await this.requireFeature(orgId, 'CUSTOM_THANK_YOU_DESIGN', 'Customized thank-you note design');
    const d = parse(TemplateSchema, input);
    const issues = noteComplianceIssues(`${d.message} ${d.supportContact ?? ''}`);
    if (issues.length) throw new BadRequestException(`This wording can't be printed (marketplace review policy): ${issues.join('; ')}. Use a neutral thank-you or support message.`);
    if (d.logoDocumentId) {
      const logo = await this.db.document.findFirst({ where: { id: d.logoDocumentId, organizationId: orgId, deletedAt: null } });
      if (!logo || !['image/png', 'image/jpeg', 'image/webp'].includes(logo.mimeType)) throw new BadRequestException('Logo must be a PNG, JPEG or WebP uploaded to this client\'s documents');
    }
    const data = {
      name: d.name, brandName: d.brandName, message: d.message, supportContact: d.supportContact ?? null, qrUrl: d.website ?? null,
      colors: d.colors, widthMm: d.widthMm, heightMm: d.heightMm, logoKey: d.logoDocumentId ?? null,
    };
    let t;
    if (id) {
      const before = await this.db.thankYouTemplate.findFirst({ where: { id, organizationId: orgId } });
      if (!before || before.status === 'ARCHIVED') throw new NotFoundException('Template not found');
      // Editing an approved design creates a new version that needs approval again; batches keep the approved one until then.
      if (before.status === 'APPROVED') {
        t = await this.db.thankYouTemplate.create({ data: { ...data, organizationId: orgId, version: before.version + 1, status: 'DRAFT' } });
      } else {
        t = await this.db.thankYouTemplate.update({ where: { id }, data: { ...data, status: 'DRAFT', revisionNote: before.revisionNote } });
      }
    } else {
      t = await this.db.thankYouTemplate.create({ data: { ...data, organizationId: orgId, status: 'DRAFT' } });
    }
    await this.audit.log({ actor: user, action: 'thank_you.save', entity: 'ThankYouTemplate', entityId: t.id, organizationId: orgId, after: { version: t.version } });
    return this.templateView(t);
  }

  /** Staff send a draft to the client for approval (customized-thank-you-note-design §11). */
  async submitTemplate(user: AuthUser, id: string) {
    const t = await this.db.thankYouTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Template not found');
    await this.access.assertOrg(user, t.organizationId);
    if (!['DRAFT', 'REVISION_REQUESTED'].includes(t.status)) throw new BadRequestException('Only a draft can be sent for approval');
    const u = await this.db.thankYouTemplate.update({ where: { id }, data: { status: 'CLIENT_REVIEW' } });
    await this.audit.log({ actor: user, action: 'thank_you.submit', entity: 'ThankYouTemplate', entityId: id, organizationId: t.organizationId });
    await this.dispatch.emit({ type: 'thank_you.review', organizationId: t.organizationId, title: 'Thank-you note design ready for your approval', body: `Version ${t.version} of "${t.name}" is ready. Review the proof and approve it, or request changes.` });
    return this.templateView(u);
  }

  async decideTemplate(user: AuthUser, id: string, input: unknown) {
    const d = parse(z.object({ decision: z.enum(['APPROVE', 'REQUEST_CHANGES']), note: z.string().trim().max(1000).optional() }), input);
    const t = await this.db.thankYouTemplate.findFirst({ where: { id, organizationId: user.organizationId! } });
    if (!t) throw new NotFoundException('Template not found');
    if (t.status !== 'CLIENT_REVIEW') throw new BadRequestException('This design is not awaiting your approval');
    if (d.decision === 'REQUEST_CHANGES' && !d.note) throw new BadRequestException('Tell us what to change');
    const u = await this.db.$transaction(async (tx) => {
      if (d.decision === 'APPROVE') {
        await tx.thankYouTemplate.updateMany({ where: { organizationId: t.organizationId, status: 'APPROVED', id: { not: id } }, data: { status: 'ARCHIVED', isActive: false } });
      }
      const row = await tx.thankYouTemplate.update({
        where: { id },
        data: d.decision === 'APPROVE' ? { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id, isActive: true } : { status: 'REVISION_REQUESTED', revisionNote: d.note },
      });
      await this.audit.log({ actor: user, action: `thank_you.${d.decision.toLowerCase()}`, entity: 'ThankYouTemplate', entityId: id, after: { version: t.version, note: d.note } }, tx);
      return row;
    });
    await this.dispatch.notifyStaff({ roles: ['OPERATIONS_MANAGER'], organizationId: t.organizationId, type: 'thank_you.decided', title: `Thank-you design ${d.decision === 'APPROVE' ? 'approved' : 'changes requested'}`, body: d.note ?? `Version ${t.version} approved by ${user.name}` });
    return this.templateView(u);
  }

  // ───────── Inventory & low-stock alerts ─────────

  async recordInventory(user: AuthUser, orgId: string, input: unknown) {
    await this.access.assertOrg(user, orgId);
    const d = parse(z.object({
      marketplace: MP,
      dataAsOf: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
      rows: z.array(z.object({
        sku: z.string().trim().min(1).max(80),
        name: z.string().trim().max(300).optional(),
        sellable: z.number().int().min(0),
        inbound: z.number().int().min(0).optional(),
        avgDailySales: z.number().min(0).nullable().optional(),
      })).min(1).max(2000),
    }), input);
    await this.requireFeature(orgId, 'LOW_STOCK_ALERTS', 'Low stock alerts');
    const dataAsOf = new Date(d.dataAsOf.length === 10 ? `${d.dataAsOf}T00:00:00Z` : d.dataAsOf);
    if (dataAsOf > new Date(Date.now() + 5 * 60_000)) throw new BadRequestException('Data date cannot be in the future');
    const skus = [...new Set(d.rows.map((r) => r.sku))];
    if (skus.length !== d.rows.length) throw new BadRequestException('Each SKU may appear only once per snapshot');
    const snapshotId = `snap_${Date.now().toString(36)}`;

    const records = await this.db.$transaction(async (tx) => {
      const out = [];
      for (const r of d.rows) {
        let product = await tx.product.findFirst({ where: { organizationId: orgId, sku: r.sku } });
        if (!product) product = await tx.product.create({ data: { organizationId: orgId, sku: r.sku, name: r.name ?? r.sku } });
        const { severity, daysOfCover } = severityFor(r.sellable, r.avgDailySales ?? null);
        out.push(await tx.inventoryRecord.create({
          data: {
            organizationId: orgId, productId: product.id, marketplace: d.marketplace as Marketplace, sku: r.sku, quantity: r.sellable, inboundUnits: r.inbound ?? null,
            avgDailySales: r.avgDailySales ?? null, daysOfCover, severity, snapshotId, dataAsOf, recordedById: user.id,
          },
          include: { product: { select: { name: true } } },
        }));
      }
      return out;
    });
    const urgent = records.filter((r) => r.severity === 'CRITICAL' || r.severity === 'HIGH');
    await this.audit.log({ actor: user, action: 'inventory.snapshot', entity: 'InventoryRecord', entityId: snapshotId, organizationId: orgId, after: { marketplace: d.marketplace, rows: records.length, urgent: urgent.length } });
    if (urgent.length) {
      const lines = urgent.sort((a, b) => Number(a.daysOfCover ?? 0) - Number(b.daysOfCover ?? 0)).slice(0, 10)
        .map((r) => `• ${r.product.name} (${r.sku}): ${r.quantity} sellable${r.daysOfCover != null ? `, ~${Number(r.daysOfCover)} days of cover` : ''} — ${r.severity}${r.inboundUnits ? ` (${r.inboundUnits} inbound)` : ''}`);
      await this.dispatch.emit({ type: 'stock.alert', organizationId: orgId, title: `${mpName(d.marketplace)} low stock: ${urgent.length} SKU${urgent.length > 1 ? 's' : ''} need attention`, body: `${lines.join('\n')}\nData as of ${dataAsOf.toLocaleString('en-IN')}. Reply in Manager Chat to plan replenishment — no purchase is made without your approval.` });
      const managers = await this.db.managerAssignment.findMany({ where: { organizationId: orgId, endedAt: null }, select: { managerId: true } });
      await this.dispatch.notifyStaff({ userIds: managers.map((m) => m.managerId), organizationId: orgId, type: 'stock.alert', title: `Low stock (${urgent.length}) for a client`, body: lines.slice(0, 3).join('\n') });
    }
    return { snapshotId, rows: records.length, urgent: urgent.length };
  }

  /** Latest snapshot per marketplace, most urgent first. */
  async inventory(user: AuthUser, orgIdParam?: string) {
    const orgId = await this.orgFor(user, orgIdParam);
    const included = await this.hasFeature(orgId, 'LOW_STOCK_ALERTS');
    const out: Record<string, unknown> = {};
    for (const mp of ['AMAZON', 'FLIPKART'] as const) {
      const latest = await this.db.inventoryRecord.findFirst({ where: { organizationId: orgId, marketplace: mp }, orderBy: { recordedAt: 'desc' }, select: { snapshotId: true, dataAsOf: true } });
      if (!latest) { out[mp] = null; continue; }
      const rows = await this.db.inventoryRecord.findMany({ where: { organizationId: orgId, snapshotId: latest.snapshotId, marketplace: mp }, include: { product: { select: { name: true } } } });
      const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, WATCH: 3, HEALTHY: 5 };
      rows.sort((a, b) => (rank[a.severity ?? ''] ?? 4) - (rank[b.severity ?? ''] ?? 4) || Number(a.daysOfCover ?? 9999) - Number(b.daysOfCover ?? 9999));
      out[mp] = {
        snapshotId: latest.snapshotId, dataAsOf: latest.dataAsOf, stale: Date.now() - latest.dataAsOf.getTime() > STALE_HOURS * 3600_000,
        rows: rows.map((r) => ({ id: r.id, sku: r.sku, name: r.product.name, sellable: r.quantity, inbound: r.inboundUnits, avgDailySales: r.avgDailySales == null ? null : Number(r.avgDailySales), daysOfCover: r.daysOfCover == null ? null : Number(r.daysOfCover), severity: r.severity, acknowledgedAt: r.acknowledgedAt })),
      };
    }
    return { included, thresholds: { CRITICAL: '0 units or ≤3 days', HIGH: '4–7 days', MEDIUM: '8–14 days', WATCH: '15–30 days', HEALTHY: '>30 days' }, marketplaces: out };
  }

  async acknowledge(user: AuthUser, id: string) {
    const r = await this.db.inventoryRecord.findFirst({ where: { id, organizationId: user.organizationId! } });
    if (!r) throw new NotFoundException('Alert not found');
    await this.db.inventoryRecord.update({ where: { id }, data: { acknowledgedAt: new Date() } });
    await this.audit.log({ actor: user, action: 'inventory.acknowledge', entity: 'InventoryRecord', entityId: id });
    return { ok: true };
  }
}
