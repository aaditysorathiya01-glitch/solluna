import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { formFor, productRef, validateForm, type FormKind, type Marketplace } from '../../../../packages/catalog-forms/src';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/zod';
import { EntitlementsService } from '../features/entitlements.service';
import type { AuthUser } from '../auth/auth.types';

/**
 * Online product lookup for the Listings & Mapping forms: the client pastes a product link / ASIN / FSN and the
 * public product details are found with Claude's web search and web fetch, then pre-fill the EMPTY form fields.
 * The client checks and completes the rest (price, stock, SKU, packer … are the seller's own data).
 * Runs in the background processor below, never inside the HTTP request. Requires ANTHROPIC_API_KEY.
 */
const MODEL = process.env.LOOKUP_MODEL || 'claude-opus-5-5';
const DAILY_LIMIT = Number(process.env.LOOKUP_DAILY_LIMIT ?? 25);
const REUSE_DAYS = 7;
const CONCURRENCY = 2;

const nullable = (type: 'string' | 'number' | 'integer') => ({ type: [type, 'null'] });
const DETAILS_TOOL: Anthropic.Beta.BetaTool = {
  name: 'submit_product_details',
  description: 'Submit the product details you found. Call this exactly once, at the end. Use null for anything you did not find in a source.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['found', 'product_name', 'brand', 'category', 'mrp_inr', 'hsn_suggestion', 'gst_rate_suggestion', 'length_cm', 'breadth_cm', 'height_cm', 'weight_kg', 'country_of_origin', 'manufacturer', 'packer', 'importer', 'shelf_life_months', 'key_features', 'description', 'variants', 'image_urls', 'barcode', 'sources', 'notes'],
    properties: {
      found: { type: 'boolean', description: 'false if the product could not be identified' },
      product_name: nullable('string'),
      brand: nullable('string'),
      category: { ...nullable('string'), description: 'Marketplace category path, e.g. "Home Cleaning > Tile & Floor Cleaners"' },
      mrp_inr: { ...nullable('number'), description: 'Maximum retail price in INR as printed on the listing, not the discounted price' },
      hsn_suggestion: { ...nullable('string'), description: 'Likely Indian GST HSN code (4-8 digits) for this product type' },
      gst_rate_suggestion: { type: ['integer', 'null'], enum: [0, 3, 5, 12, 18, 28, null], description: 'Likely GST rate in percent for that HSN' },
      length_cm: nullable('number'), breadth_cm: nullable('number'), height_cm: nullable('number'), weight_kg: nullable('number'),
      country_of_origin: nullable('string'),
      manufacturer: { ...nullable('string'), description: 'Manufacturer name and address as listed' },
      packer: { ...nullable('string'), description: 'Packer name and address as listed' },
      importer: { ...nullable('string'), description: 'Importer name and address, only for imported products' },
      shelf_life_months: nullable('integer'),
      key_features: { type: 'array', items: { type: 'string' }, description: 'Up to 6 short feature points' },
      description: nullable('string'),
      variants: { ...nullable('string'), description: 'Sizes / colours / pack options offered' },
      image_urls: { type: 'array', items: { type: 'string' }, description: 'Direct product image URLs, at most 6' },
      barcode: { ...nullable('string'), description: 'EAN/UPC/GTIN if shown' },
      sources: { type: 'array', items: { type: 'string' }, description: 'URLs the details came from' },
      notes: { ...nullable('string'), description: 'Anything the seller should double-check' },
    },
  },
};

const SYSTEM = `You help Indian e-commerce sellers fill Amazon.in and Flipkart listing forms.
Given a product link or ID, find the product's public details using web_search, and web_fetch on the given link when it helps.
Rules:
- Report only what you found in a source. Never invent values; use null when unsure.
- MRP is the printed maximum retail price in INR, not the selling or discounted price.
- HSN and GST rate are suggestions from the product type under Indian GST; the seller confirms them.
- Measurements in cm and kg; convert units when needed.
- When done, call submit_product_details exactly once.`;

const Details = z.object({
  found: z.boolean(), product_name: z.string().nullable(), brand: z.string().nullable(), category: z.string().nullable(), mrp_inr: z.number().nullable(),
  hsn_suggestion: z.string().nullable(), gst_rate_suggestion: z.number().nullable(), length_cm: z.number().nullable(), breadth_cm: z.number().nullable(),
  height_cm: z.number().nullable(), weight_kg: z.number().nullable(), country_of_origin: z.string().nullable(), manufacturer: z.string().nullable(),
  packer: z.string().nullable(), importer: z.string().nullable(), shelf_life_months: z.number().nullable(), key_features: z.array(z.string()),
  description: z.string().nullable(), variants: z.string().nullable(), image_urls: z.array(z.string()), barcode: z.string().nullable(),
  sources: z.array(z.string()), notes: z.string().nullable(),
});
type Details = z.infer<typeof Details>;

const StartSchema = z.object({ marketplace: z.enum(['FLIPKART', 'AMAZON']), kind: z.enum(['MAPPING', 'NEW_LISTING']), link: z.string().trim().min(5).max(500) });

@Injectable()
export class ProductLookupService implements OnModuleInit {
  private readonly log = new Logger('ProductLookup');
  private running = 0;

  constructor(private readonly db: PrismaService, private readonly ent: EntitlementsService, private readonly audit: AuditService) {}

  get available() { return Boolean(process.env.ANTHROPIC_API_KEY); }

  onModuleInit() {
    setInterval(() => this.tick().catch((e) => this.log.error(e)), 2000).unref();
  }

  async start(user: AuthUser, input: unknown) {
    if (!this.available) throw new HttpException('Online lookup is not set up yet. Fill the details manually.', HttpStatus.SERVICE_UNAVAILABLE);
    const d = parse(StartSchema, input);
    const orgId = user.organizationId!;
    if (!this.ent.check(await this.ent.context(orgId), 'CATALOG_MAPPING').allowed) throw new ForbiddenException('An active plan is needed to look up products');
    const ref = productRef(d.marketplace as Marketplace, d.link)?.id ?? (/^https?:\/\//i.test(d.link) ? normaliseLink(d.link) : null);
    if (!ref) throw new BadRequestException(`Paste the product page link or the ${d.marketplace === 'AMAZON' ? 'ASIN' : 'FSN'}`);

    // A recent result for the same product is reused: no wait and no cost.
    const recent = await this.db.productLookup.findFirst({ where: { marketplace: d.marketplace, ref, status: 'DONE', createdAt: { gte: new Date(Date.now() - REUSE_DAYS * 86_400_000) } }, orderBy: { createdAt: 'desc' } });
    if (recent) {
      const row = await this.db.productLookup.create({ data: { organizationId: orgId, createdById: user.id, marketplace: d.marketplace, kind: d.kind, link: d.link, ref, status: 'DONE', cached: true, result: recent.result ?? undefined, sources: recent.sources ?? undefined, notes: recent.notes, finishedAt: new Date() } });
      return this.view(row, d.marketplace as Marketplace, d.kind as FormKind);
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const used = await this.db.productLookup.count({ where: { organizationId: orgId, cached: false, createdAt: { gte: today } } });
    if (used >= DAILY_LIMIT) throw new HttpException(`Daily limit of ${DAILY_LIMIT} product lookups reached. Try again tomorrow or fill the details manually.`, HttpStatus.TOO_MANY_REQUESTS);
    const row = await this.db.productLookup.create({ data: { organizationId: orgId, createdById: user.id, marketplace: d.marketplace, kind: d.kind, link: d.link, ref } });
    await this.audit.log({ actor: user, action: 'catalog.product_lookup', entity: 'ProductLookup', entityId: row.id, after: { marketplace: d.marketplace, ref } });
    setImmediate(() => this.tick().catch((e) => this.log.error(e)));
    return this.view(row, d.marketplace as Marketplace, d.kind as FormKind);
  }

  async get(user: AuthUser, id: string) {
    const row = await this.db.productLookup.findFirst({ where: { id, organizationId: user.organizationId! } });
    if (!row) throw new NotFoundException('Lookup not found');
    return this.view(row, row.marketplace as Marketplace, row.kind as FormKind);
  }

  /** Only fields of the chosen form, validated like a template, so nothing invalid reaches the client. */
  private view(row: { id: string; status: string; result: Prisma.JsonValue; sources: Prisma.JsonValue; notes: string | null; error: string | null; cached: boolean }, mp: Marketplace, kind: FormKind) {
    let fields: Record<string, string | number> = {};
    if (row.status === 'DONE' && row.result) fields = validateForm(formFor(mp, kind), toFormValues(row.result as unknown as Details), { partial: true }).data;
    delete fields.productRef;
    return { id: row.id, status: row.status, fields, sources: (row.sources as string[] | null) ?? [], notes: row.notes, error: row.error, cached: row.cached };
  }

  async tick() {
    await this.db.productLookup.updateMany({ where: { status: 'RUNNING', createdAt: { lt: new Date(Date.now() - 5 * 60_000) } }, data: { status: 'FAILED', error: 'The lookup took too long. Fill the details manually or try again.', finishedAt: new Date() } });
    while (this.running < CONCURRENCY) {
      const next = await this.db.productLookup.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
      if (!next) return;
      const claimed = await this.db.productLookup.updateMany({ where: { id: next.id, status: 'QUEUED' }, data: { status: 'RUNNING' } });
      if (!claimed.count) continue;
      this.running++;
      this.run(next.id).finally(() => { this.running--; });
    }
  }

  private async run(id: string) {
    const row = await this.db.productLookup.findUniqueOrThrow({ where: { id } });
    try {
      const details = await this.lookup(row.marketplace as Marketplace, row.link);
      if (!details.found) throw new Error('We could not find this product online. Check the link, or fill the details manually.');
      await this.db.productLookup.update({ where: { id }, data: { status: 'DONE', result: details as unknown as Prisma.InputJsonValue, sources: details.sources.slice(0, 8), notes: details.notes, finishedAt: new Date() } });
    } catch (e) {
      const msg = e instanceof Anthropic.APIError ? 'Online lookup is unavailable right now. Fill the details manually or try again later.' : (e as Error).message;
      if (e instanceof Anthropic.APIError) this.log.warn(`Lookup ${id}: API ${e.status} ${e.message}`);
      await this.db.productLookup.update({ where: { id }, data: { status: 'FAILED', error: msg.slice(0, 300), finishedAt: new Date() } });
    }
  }

  /** Claude with web search + web fetch; the answer arrives as the strict submit_product_details tool call. */
  private async lookup(mp: Marketplace, link: string): Promise<Details> {
    const client = new Anthropic();
    const site = mp === 'AMAZON' ? 'Amazon.in' : 'Flipkart';
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: `Find the product details for this ${site} product: ${link}\nThe seller will list it on ${site}.` }];
    for (let turn = 0; turn < 6; turn++) {
      const res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: SYSTEM,
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: 6, user_location: { type: 'approximate', country: 'IN' } },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 },
          DETAILS_TOOL,
        ],
        tool_choice: { type: 'auto' },
        messages,
      });
      if (res.stop_reason === 'refusal') throw new Error('This product could not be looked up automatically. Fill the details manually.');
      const call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'submit_product_details');
      if (call) {
        const parsed = Details.safeParse(call.input);
        if (parsed.success) return parsed.data;
        throw new Error('The online details could not be read. Fill the details manually.');
      }
      // Server-side search loop paused: send the turn back unchanged and the API resumes it.
      const last = messages[messages.length - 1];
      if (res.stop_reason === 'pause_turn') {
        if (last.role === 'assistant' && Array.isArray(last.content)) last.content = [...last.content, ...res.content];
        else messages.push({ role: 'assistant', content: res.content });
        continue;
      }
      // Finished without the tool call: ask for it once more.
      messages.push({ role: 'assistant', content: res.content }, { role: 'user', content: 'Now call submit_product_details with what you found (null for anything unknown).' });
    }
    throw new Error('The online lookup did not finish. Fill the details manually or try again.');
  }
}

const COUNTRY_ALIASES: Record<string, string> = { 'made in india': 'India', bharat: 'India', prc: 'China', usa: 'United States', 'u.s.a.': 'United States', us: 'United States', uk: 'United Kingdom', uae: 'United Arab Emirates', korea: 'South Korea' };
const COUNTRIES = ['India', 'China', 'Bangladesh', 'Vietnam', 'Sri Lanka', 'Nepal', 'Thailand', 'Indonesia', 'Malaysia', 'Taiwan', 'South Korea', 'Japan', 'Turkey', 'United Arab Emirates', 'Germany', 'Italy', 'United Kingdom', 'United States'];

/** Lookup result → the forms' field keys (values are validated per form afterwards). */
export function toFormValues(d: Details): Record<string, unknown> {
  const c = d.country_of_origin?.trim();
  const country = c ? (COUNTRIES.find((x) => x.toLowerCase() === c.toLowerCase()) ?? COUNTRY_ALIASES[c.toLowerCase()] ?? 'Other') : undefined;
  const barcode = d.barcode?.replace(/\D/g, '') ?? '';
  const v: Record<string, unknown> = {
    productName: d.product_name, productTitle: d.product_name, brand: d.brand, category: d.category,
    mrp: d.mrp_inr, hsn: d.hsn_suggestion?.replace(/\D/g, ''), taxCode: d.gst_rate_suggestion == null ? undefined : `GST_${d.gst_rate_suggestion}`,
    lengthCm: d.length_cm, breadthCm: d.breadth_cm, heightCm: d.height_cm, weightKg: d.weight_kg,
    countryOfOrigin: country, manufacturerDetails: d.manufacturer, packerDetails: d.packer, importerDetails: d.importer, shelfLifeMonths: d.shelf_life_months,
    keyFeatures: d.key_features.length ? d.key_features.slice(0, 6).join('\n') : undefined, description: d.description, variants: d.variants,
    imageLinks: d.image_urls.length ? d.image_urls.slice(0, 6).join('\n') : undefined,
    productIdType: barcode.length === 13 ? 'EAN' : barcode.length === 12 ? 'UPC' : barcode ? 'GTIN' : undefined, productId: barcode || undefined,
  };
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined && x !== ''));
}

const normaliseLink = (url: string) => { try { const u = new URL(url); return `${u.hostname.replace(/^www\./, '')}${u.pathname}`.toLowerCase().slice(0, 200); } catch { return null; } };
