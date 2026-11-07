import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { formFor, validateForm, type FormKind, type Marketplace } from '../../../../packages/catalog-forms/src';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/zod';
import { CatalogService } from '../catalog/catalog.service';
import type { AuthUser } from '../auth/auth.types';

const Target = { marketplace: z.enum(['FLIPKART', 'AMAZON']), kind: z.enum(['MAPPING', 'NEW_LISTING']) };
const SubmitSchema = z.object({ ...Target, data: z.record(z.string(), z.unknown()), saveTemplateAs: z.string().trim().min(2).max(60).optional() });
const TemplateSchema = z.object({ ...Target, name: z.string().trim().min(2).max(60), data: z.record(z.string(), z.unknown()) });
const MP = { FLIPKART: 'Flipkart', AMAZON: 'Amazon' } as const;

class FormInvalid extends BadRequestException {
  constructor(errors: Record<string, string>) { super({ statusCode: 400, message: 'Please fix the highlighted fields', fieldErrors: errors }); }
}

/** Listings & Mapping forms → orchestrator requests (catalog mapping / new listing quota), plus reusable templates. */
@Injectable()
export class CatalogFormsService {
  constructor(private readonly db: PrismaService, private readonly catalog: CatalogService, private readonly audit: AuditService) {}

  async list(user: AuthUser) {
    const orgId = user.organizationId!;
    const [forms, templates] = await Promise.all([
      this.db.catalogForm.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.db.catalogTemplate.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } }),
    ]);
    const reqs = await this.db.serviceRequest.findMany({ where: { id: { in: forms.map((f) => f.requestId).filter((x): x is string => Boolean(x)) } }, select: { id: true, status: true, entitlement: true } });
    const byId = new Map(reqs.map((r) => [r.id, r]));
    return {
      submissions: forms.map((f) => ({ id: f.id, marketplace: f.marketplace, kind: f.kind, title: f.title, createdAt: f.createdAt, requestId: f.requestId, status: byId.get(f.requestId ?? '')?.status ?? null, entitlement: byId.get(f.requestId ?? '')?.entitlement ?? null })),
      templates: templates.map((t) => ({ id: t.id, marketplace: t.marketplace, kind: t.kind, name: t.name, data: t.data, updatedAt: t.updatedAt })),
    };
  }

  async submit(user: AuthUser, input: unknown) {
    const d = parse(SubmitSchema, input);
    const def = formFor(d.marketplace as Marketplace, d.kind as FormKind);
    const { data, errors } = validateForm(def, d.data);
    await this.checkImages(user, def, data, errors);
    if (Object.keys(errors).length) throw new FormInvalid(errors);
    const label = String(data.productTitle ?? data.modelName ?? data.productName ?? data.productRef ?? data.productLink ?? data.sellerSku).slice(0, 80);
    const title = `${MP[d.marketplace]} ${d.kind === 'MAPPING' ? 'mapping' : 'new listing'}: ${label} (SKU ${data.sellerSku})`;
    // Reuse the catalog workflow so the manager's tools (mapping confidence, listing lifecycle, quota) work unchanged.
    let requestId: string;
    if (d.kind === 'MAPPING') {
      const r = await this.catalog.submitMapping(user, { marketplace: d.marketplace, items: [{ identifier: String(data.productLink), sellerSku: String(data.sellerSku), productName: data.productName ? String(data.productName) : undefined }] });
      requestId = r.requestId;
    } else {
      const orgId = user.organizationId!;
      const gst = /^GST_(\d+)$/.exec(String(data.taxCode ?? ''))?.[1];
      const product = {
        name: String(data.productTitle ?? `${data.brand} ${data.modelName}`), brand: String(data.brand), category: String(data.category ?? data.vertical), sku: String(data.sellerSku), hsn: String(data.hsn),
        gstRate: gst ? Number(gst) : undefined, mrp: Number(data.mrp), sellingPrice: Number(data.sellingPrice),
        specs: [data.keyFeatures, data.description, data.usageInstructions].filter(Boolean).join('\n\n').slice(0, 5000), variations: data.variants ? String(data.variants) : undefined,
      };
      const existing = await this.db.product.findFirst({ where: { organizationId: orgId, sku: product.sku } });
      const productId = existing ? (await this.catalog.updateProduct(user, existing.id, product)).id : (await this.catalog.createProduct(user, product)).id;
      const r = (await this.catalog.submitListing(user, { productId, marketplaces: [d.marketplace], notes: `Submitted with the ${MP[d.marketplace]} new listing form` })).results[0];
      if (!r.requestId) throw new ConflictException(`A ${MP[d.marketplace]} listing for SKU ${product.sku} is already in progress`);
      requestId = r.requestId;
    }
    const req = await this.db.serviceRequest.findUniqueOrThrow({ where: { id: requestId } });
    await this.db.serviceRequest.update({ where: { id: requestId }, data: { title, details: { ...(req.details as object), form: `${d.marketplace}_${d.kind}`, fields: data } as Prisma.InputJsonValue } });
    const request = { id: req.id, status: req.status, entitlement: req.entitlement };
    const form = await this.db.catalogForm.create({ data: { organizationId: user.organizationId!, marketplace: d.marketplace, kind: d.kind, title, data: data as Prisma.InputJsonValue, requestId, createdById: user.id } });
    await this.audit.log({ actor: user, action: 'catalog.form_submitted', entity: 'CatalogForm', entityId: form.id, after: { marketplace: d.marketplace, kind: d.kind, requestId: request.id } });
    const template = d.saveTemplateAs ? await this.saveTemplate(user, { marketplace: d.marketplace, kind: d.kind, name: d.saveTemplateAs, data: d.data }) : null;
    return { id: form.id, request, template };
  }

  /** Image fields hold document ids: each must be this client's own uploaded image. */
  private async checkImages(user: AuthUser, def: ReturnType<typeof formFor>, data: Record<string, string | number>, errors: Record<string, string>) {
    for (const f of def.sections.flatMap((s) => s.fields).filter((x) => x.type === 'images')) {
      const ids = typeof data[f.key] === 'string' ? String(data[f.key]).split(',').filter(Boolean) : [];
      if (!ids.length) { if (f.required) errors[f.key] = `${f.label}: upload at least 1 image`; continue; }
      const found = await this.db.document.count({ where: { id: { in: ids }, organizationId: user.organizationId!, deletedAt: null, kind: 'LISTING_ASSETS', mimeType: { startsWith: 'image/' } } });
      if (found !== ids.length) errors[f.key] = `${f.label}: some images are missing — upload them again`;
    }
  }

  /** Templates keep whatever was filled (partial is fine); saving under an existing name updates it. */
  async saveTemplate(user: AuthUser, input: unknown) {
    const d = parse(TemplateSchema, input);
    const { data, errors } = validateForm(formFor(d.marketplace as Marketplace, d.kind as FormKind), d.data, { partial: true });
    if (Object.keys(errors).length) throw new FormInvalid(errors);
    if (!Object.keys(data).length) throw new BadRequestException('Fill in at least one field before saving a template');
    const orgId = user.organizationId!;
    const t = await this.db.catalogTemplate.upsert({
      where: { organizationId_marketplace_kind_name: { organizationId: orgId, marketplace: d.marketplace, kind: d.kind, name: d.name } },
      create: { organizationId: orgId, marketplace: d.marketplace, kind: d.kind, name: d.name, data: data as Prisma.InputJsonValue, createdById: user.id },
      update: { data: data as Prisma.InputJsonValue },
    });
    return { id: t.id, marketplace: t.marketplace, kind: t.kind, name: t.name, data: t.data, updatedAt: t.updatedAt };
  }

  async deleteTemplate(user: AuthUser, id: string) {
    const r = await this.db.catalogTemplate.deleteMany({ where: { id, organizationId: user.organizationId! } });
    if (!r.count) throw new NotFoundException('Template not found');
    return { deleted: true };
  }
}
