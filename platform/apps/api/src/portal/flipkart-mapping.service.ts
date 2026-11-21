import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Page } from 'playwright-core';
import { productRef } from '../../../../packages/catalog-forms/src';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { CatalogFormsService } from '../catalog-forms/catalog-forms.service';
import { PipelineService } from '../chat/pipeline.service';
import type { AuthUser } from '../auth/auth.types';
import { PortalBotService } from './portal-bot.service';

/**
 * Flipkart mapping bot (owner, 21 Nov 2026: "mapping AI karega, team nahi").
 * Recipe learned live on Seller Hub: Listings → Add New Listing (#dashboard/listingsInProgress) → paste the FSN in
 * "Create listings using products available on Flipkart" → START SELLING → "Selling Information" form.
 * Auto mode (owner, 21 Nov 2026, after the live test passed): fill → screenshots → Submit → check the SKU in Listings in
 * Progress. Any value Flipkart does not offer, or a required field left empty, stops the run before Submit.
 * PORTAL_BOT_REVIEW=on restores safety mode: stop before Submit until the owner approves in Admin → Portal bot.
 * No AI call is used: field names are fixed (recipe), so the client's values go in exactly as given.
 */
type Kind = 'fill' | 'select' | 'date';
/** Client form key → Seller Hub field name (the `name` attribute in the Selling Information form). */
const RECIPE: { key: string; name: string; kind: Kind; label: string }[] = [
  { key: 'sellerSku', name: 'sku_id', kind: 'fill', label: 'Seller SKU ID' },
  { key: 'listingStatus', name: 'listing_status', kind: 'select', label: 'Listing Status' },
  { key: 'mrp', name: 'mrp', kind: 'fill', label: 'MRP' },
  { key: 'sellingPrice', name: 'flipkart_selling_price', kind: 'fill', label: 'Your selling price' },
  { key: 'minOrderQty', name: 'minimum_order_quantity', kind: 'select', label: 'Minimum Order Quantity' },
  { key: 'fulfilmentBy', name: 'service_profile', kind: 'select', label: 'Fulfilment by' },
  { key: 'procurementType', name: 'procurement_type', kind: 'select', label: 'Procurement type' },
  { key: 'procurementSlaDays', name: 'shipping_days', kind: 'fill', label: 'Procurement SLA' },
  { key: 'stock', name: 'stock_size', kind: 'fill', label: 'Stock' },
  { key: 'shippingProvider', name: 'shipping_provider', kind: 'select', label: 'Shipping provider' },
  { key: 'localHandlingFee', name: 'local_shipping_fee_from_buyer', kind: 'fill', label: 'Local handling fee' },
  { key: 'zonalHandlingFee', name: 'zonal_shipping_fee_from_buyer', kind: 'fill', label: 'Zonal handling fee' },
  { key: 'nationalHandlingFee', name: 'national_shipping_fee_from_buyer', kind: 'fill', label: 'National handling fee' },
  { key: 'lengthCm', name: 'length_p0', kind: 'fill', label: 'Length (cm)' },
  { key: 'breadthCm', name: 'breadth_p0', kind: 'fill', label: 'Breadth (cm)' },
  { key: 'heightCm', name: 'height_p0', kind: 'fill', label: 'Height (cm)' },
  { key: 'weightKg', name: 'weight_p0', kind: 'fill', label: 'Weight (kg)' },
  { key: 'hsn', name: 'hsn', kind: 'fill', label: 'HSN' },
  { key: 'luxuryCessPct', name: 'luxury_cess', kind: 'fill', label: 'Luxury Cess' },
  { key: 'taxCode', name: 'tax_code', kind: 'select', label: 'Tax Code' },
  { key: 'countryOfOrigin', name: 'country_of_origin', kind: 'select', label: 'Country Of Origin' },
  { key: 'manufacturerDetails', name: 'manufacturer_details', kind: 'fill', label: 'Manufacturer Details' },
  { key: 'packerDetails', name: 'packer_details', kind: 'fill', label: 'Packer Details' },
  { key: 'importerDetails', name: 'importer_details', kind: 'fill', label: 'Importer Details' },
  { key: 'manufacturingDate', name: 'earliest_mfg_date', kind: 'date', label: 'Manufacturing date' },
  { key: 'shelfLifeMonths', name: 'shelf_life', kind: 'fill', label: 'Shelf Life' },
];
const LISTINGS = 'https://seller.flipkart.com/index.html#dashboard/listingsInProgress';
/** Key-order-independent JSON (Postgres jsonb re-orders keys). */
const stable = (v: unknown): string => v && typeof v === 'object' && !Array.isArray(v) ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, '');

interface Shot { step: string; png: string }
interface RunInput { fsn: string; sku: string; values: Record<string, string> }

@Injectable()
export class FlipkartMappingService implements OnModuleInit {
  private readonly log = new Logger('FlipkartMappingBot');
  constructor(
    private readonly db: PrismaService, private readonly audit: AuditService, private readonly bot: PortalBotService,
    private readonly forms: CatalogFormsService, private readonly pipelines: PipelineService,
  ) {}

  /** A submitted Flipkart mapping form starts the bot at once (safety mode: it stops before Submit). */
  onModuleInit() {
    this.forms.submittedListeners.push(async (e) => {
      if (e.marketplace !== 'FLIPKART' || e.kind !== 'MAPPING' || !this.bot.configured || process.env.PORTAL_BOT_AUTO === 'off') return;
      await this.prepare(null, e.requestId).catch((err) => this.log.warn(`auto prepare ${e.requestId}: ${(err as Error).message}`));
    });
    // Live check: submitted offers are looked up in My Listings → Active (15 min after Submit, then every 3 hours, 14 days).
    setInterval(() => this.liveSweep().catch((e) => this.log.warn(`live sweep: ${(e as Error).message}`)), 5 * 60_000).unref();
  }

  private sweeping = false;
  private async liveSweep() {
    if (this.sweeping || !this.bot.configured) return;
    this.sweeping = true;
    try {
      const now = Date.now();
      const due = await this.db.portalRun.findMany({ where: { kind: 'FLIPKART_MAPPING', status: 'SUBMITTED', createdAt: { gt: new Date(now - 14 * 86_400_000) } }, orderBy: { updatedAt: 'asc' }, take: 10 });
      const ready = due.filter((r) => {
        const age = now - r.updatedAt.getTime();
        return age > (r.error === 'live-check' ? 3 * 3_600_000 : 15 * 60_000);
      });
      if (ready.length) await this.checkLive(null, ready.map((r) => r.id));
    } finally { this.sweeping = false; }
  }

  /**
   * Evidence that the offer is live (learned 21 Nov 2026): My Listings → Active, searched by SKU
   * (#dashboard/listings-management?listingState=ACTIVE&listingsSearchQuery=SKU) shows the SKU row. Then: tasks and request
   * COMPLETED, pipeline step "Flipkart confirms" = LIVE, and the manager confirms to the client.
   */
  async checkLive(user: AuthUser | null, ids: string[]) {
    const runs = await this.db.portalRun.findMany({ where: { id: { in: ids }, status: 'SUBMITTED' } });
    if (!runs.length) throw new BadRequestException('No submitted run to check');
    const out: { id: string; live: boolean }[] = [];
    const opened = await this.bot.openPage('ops-flipkart');
    try {
      await this.bot.flipkartLogin(opened.holder.page);
      for (const run of runs) {
        const input = run.input as unknown as RunInput;
        const page = opened.holder.page;
        await page.goto(`https://seller.flipkart.com/index.html#dashboard/listings-management?listingState=ACTIVE&listingsSearchQuery=${encodeURIComponent(input.sku)}&partnerContext=ALL`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(9000);
        await this.bot.dismissPopups(page);
        const activeTab = (await page.locator('[id$="tabitem-ACTIVE"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
        const count = Number(/(\d+)\s*$/.exec(activeTab)?.[1] ?? 0);
        const row = await page.getByText(input.sku, { exact: true }).count().catch(() => 0);
        const live = count > 0 && row > 0;
        out.push({ id: run.id, live });
        if (!live) { await this.db.portalRun.update({ where: { id: run.id }, data: { error: 'live-check' } }); continue; }
        const png = await page.screenshot({ type: 'png' }).catch(() => null);
        const shots = [...((run.shots as unknown as Shot[] | null) ?? []), ...(png ? [{ step: 'My Listings → Active (live)', png: png.toString('base64') }] : [])];
        await this.db.portalRun.update({ where: { id: run.id }, data: { status: 'LIVE', error: null, shots: shots as unknown as Prisma.InputJsonValue } });
        await this.afterLive(run.id, run.organizationId, run.requestId, `${run.listingRef ?? `SKU ${input.sku} / FSN ${input.fsn}`}`, user);
      }
    } finally { await opened.close(); }
    return out;
  }

  private async afterLive(id: string, orgId: string, requestId: string | null, listingRef: string, user: AuthUser | null) {
    const evidence = { summary: `Flipkart My Listings shows the offer in Active (checked by the portal bot, run ${id})`, marketplaceRef: listingRef };
    await this.db.task.updateMany({ where: { organizationId: orgId, requestId, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, data: { status: 'COMPLETED', evidence } });
    if (requestId) await this.db.serviceRequest.updateMany({ where: { id: requestId, organizationId: orgId }, data: { status: 'COMPLETED' } });
    await this.audit.log({ actor: user ?? undefined, action: 'portal_bot.mapping_live', entity: 'PortalRun', entityId: id, organizationId: orgId, after: { listingRef } });
    const pr = await this.db.pipelineRun.findFirst({ where: { organizationId: orgId, pipeline: 'CATALOG_MAPPING', branch: 'FLIPKART_MAPPING', status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
    // Step 2 = "Flipkart confirms the listing(s)"; finishing it moves to the client step, which makes the manager tell the client.
    if (pr?.stepIndex === 2) await this.pipelines.teamAdvance(user, orgId, pr.id, { fields: { outcome: 'LIVE' } }).catch((e) => this.log.warn(`pipeline live: ${(e as Error).message}`));
    else for (const l of this.pipelines.clientTurnListeners) await l(orgId, `Flipkart mapping (${listingRef}) is now LIVE: it shows in Flipkart My Listings → Active. Confirm this to the client.`).catch(() => undefined);
  }

  /** Recent runs for Admin → Portal bot (screenshots only in the single-run view). */
  async list() {
    const runs = await this.db.portalRun.findMany({ orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, organizationId: true, requestId: true, kind: true, status: true, input: true, missing: true, error: true, listingRef: true, createdAt: true, updatedAt: true } });
    const orgs = await this.db.organization.findMany({ where: { id: { in: [...new Set(runs.map((r) => r.organizationId))] } }, select: { id: true, legalName: true, brandName: true } });
    return runs.map((r) => ({ ...r, client: orgs.find((o) => o.id === r.organizationId)?.brandName ?? orgs.find((o) => o.id === r.organizationId)?.legalName ?? r.organizationId }));
  }

  async get(id: string) {
    const r = await this.db.portalRun.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Run not found');
    return r;
  }

  /** Values to enter: the client's mapping form for this request (validated when submitted) + the FSN. */
  private async inputFor(requestId: string) {
    const form = await this.db.catalogForm.findFirst({ where: { requestId, marketplace: 'FLIPKART', kind: 'MAPPING' }, orderBy: { createdAt: 'desc' } });
    if (!form) throw new NotFoundException('No Flipkart mapping form for this request');
    const data = form.data as Record<string, unknown>;
    const fsn = productRef('FLIPKART', String(data.productLink ?? ''))?.id;
    if (!fsn) throw new BadRequestException('The form has no valid FSN / Flipkart link');
    const values: Record<string, string> = {};
    for (const r of RECIPE) if (data[r.key] !== undefined && data[r.key] !== null && String(data[r.key]).trim() !== '') values[r.key] = String(data[r.key]).trim();
    return { orgId: form.organizationId, input: { fsn, sku: String(data.sellerSku), values } satisfies RunInput };
  }

  /** Stage 1 (no Submit): fill the form and wait for the owner's approval. */
  async prepare(user: AuthUser | null, requestId: string) {
    const { orgId, input } = await this.inputFor(requestId);
    const busy = await this.db.portalRun.findFirst({ where: { requestId, status: { in: ['RUNNING', 'SUBMITTING'] } } });
    if (busy) throw new BadRequestException('The bot is already working on this request');
    const run = await this.db.portalRun.create({ data: { organizationId: orgId, requestId, kind: 'FLIPKART_MAPPING', input: input as unknown as Prisma.InputJsonValue } });
    await this.audit.log({ actor: user ?? undefined, action: 'portal_bot.mapping_prepare', entity: 'PortalRun', entityId: run.id, organizationId: orgId, after: { requestId, fsn: input.fsn, sku: input.sku } });
    // Owner, 21 Nov 2026: the recipe passed its live test, so the bot submits on its own (no per-listing approval).
    // PORTAL_BOT_REVIEW=on brings back safety mode (stop before Submit, owner approves in Admin → Portal bot).
    const auto = process.env.PORTAL_BOT_REVIEW !== 'on';
    void this.execute(run.id, input, auto, user).catch((e) => this.log.error(e));
    return { id: run.id, status: run.status };
  }

  /** Stage 2: the owner approved the screenshots → same values again, then Submit, then verify in Listings in Progress. */
  async approve(user: AuthUser, id: string) {
    const run = await this.get(id);
    if (run.status !== 'READY') throw new BadRequestException(`Only a READY run can be approved (this one is ${run.status})`);
    const { input } = await this.inputFor(run.requestId!);
    if (stable(input) !== stable(run.input)) throw new BadRequestException('The client form changed after this run. Run the bot again and review the new screenshots.');
    await this.db.portalRun.update({ where: { id }, data: { status: 'SUBMITTING', approvedById: user.id, error: null } });
    await this.audit.log({ actor: user, action: 'portal_bot.mapping_approved', entity: 'PortalRun', entityId: id, organizationId: run.organizationId, after: { fsn: input.fsn, sku: input.sku } });
    void this.execute(id, input, true, user).catch((e) => this.log.error(e));
    return { id, status: 'SUBMITTING' };
  }

  /** Owner confirms from the screenshot that Flipkart accepted a run the bot could not verify (no second Submit). */
  async confirm(user: AuthUser, id: string) {
    const run = await this.get(id);
    if (run.status !== 'FAILED' || !run.error?.startsWith('Submitted, but')) throw new BadRequestException('Only a run that was submitted but not verified can be confirmed');
    const input = run.input as unknown as RunInput;
    const listingRef = `SKU ${input.sku} / FSN ${input.fsn}`;
    await this.db.portalRun.update({ where: { id }, data: { status: 'SUBMITTED', error: null, listingRef } });
    await this.audit.log({ actor: user, action: 'portal_bot.mapping_confirmed', entity: 'PortalRun', entityId: id, organizationId: run.organizationId, after: { listingRef } });
    await this.afterSubmit(id, input, listingRef, user);
    return { id, status: 'SUBMITTED' };
  }

  async reject(user: AuthUser, id: string, note?: string) {
    const run = await this.get(id);
    if (run.status !== 'READY') throw new BadRequestException('Only a READY run can be rejected');
    await this.db.portalRun.update({ where: { id }, data: { status: 'REJECTED', error: note?.slice(0, 500) ?? 'Rejected by the owner' } });
    await this.audit.log({ actor: user, action: 'portal_bot.mapping_rejected', entity: 'PortalRun', entityId: id, organizationId: run.organizationId, after: { note } });
    return { id, status: 'REJECTED' };
  }

  private async execute(id: string, input: RunInput, submit: boolean, approver: AuthUser | null) {
    const shots: Shot[] = [];
    const snap = async (page: Page, step: string, fullPage = false) => {
      const png = await page.screenshot({ type: 'png', fullPage }).catch(() => null);
      if (png) shots.push({ step, png: png.toString('base64') });
    };
    let close: (() => Promise<void>) | undefined;
    try {
      const opened = await this.bot.openPage('ops-flipkart');
      close = opened.close;
      const pg = () => opened.holder.page;
      await this.bot.flipkartLogin(pg());
      await this.openForm(pg(), input.fsn);
      const { filled, missing } = await this.fill(pg(), input.values);
      await this.formShots(pg(), snap);
      if (missing.length) {
        await this.db.portalRun.update({ where: { id }, data: { status: 'FAILED', filled, missing, shots: shots as unknown as Prisma.InputJsonValue, error: `Could not enter ${missing.length} field(s); nothing was submitted` } });
        return;
      }
      if (!submit) {
        await this.db.portalRun.update({ where: { id }, data: { status: 'READY', filled, missing, shots: shots as unknown as Prisma.InputJsonValue } });
        return;
      }
      // Submit, then Flipkart's own confirmation is the evidence: mapping to an existing FSN shows "Listing added
      // successfully" and goes straight to My Listings (it never appears in Listings in Progress, learned 21 Nov 2026).
      await pg().getByRole('button', { name: /^submit$/i }).last().click({ timeout: 15_000 });
      const ok = await pg().getByText(/listing added successfully/i).first().waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
      await snap(pg(), 'After Submit');
      if (!ok) {
        const errors = await this.formErrors(pg());
        throw new Error(errors.length ? `Flipkart rejected the form: ${errors.join('; ').slice(0, 400)}` : 'Submitted, but Flipkart did not show "Listing added successfully". Check the screenshot before retrying.');
      }
      const listingRef = `SKU ${input.sku} / FSN ${input.fsn}`;
      await this.db.portalRun.update({ where: { id }, data: { status: 'SUBMITTED', filled, shots: shots as unknown as Prisma.InputJsonValue, listingRef } });
      await this.afterSubmit(id, input, listingRef, approver);
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0].slice(0, 500);
      this.log.warn(`run ${id}: ${msg}`);
      await this.db.portalRun.update({ where: { id }, data: { status: 'FAILED', error: msg, shots: shots as unknown as Prisma.InputJsonValue } }).catch(() => undefined);
    } finally {
      await close?.();
    }
  }

  /** Listings in Progress → FSN search → START SELLING → wait for the Selling Information form. */
  private async openForm(page: Page, fsn: string) {
    await page.goto(LISTINGS, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(8000);
    const search = page.locator('input[placeholder^="Search by Brand, FSN"]').first();
    for (let i = 0; i < 2; i++) {
      await this.bot.dismissPopups(page);
      try { await search.click({ timeout: 10_000 }); break; } catch (e) { if (i) throw e; await page.waitForTimeout(1500); }
    }
    await search.fill('');
    await search.pressSequentially(fsn, { delay: 50 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(7000);
    await this.bot.dismissPopups(page);
    const start = page.locator('text=START SELLING').first();
    if (!(await start.isVisible({ timeout: 10_000 }).catch(() => false))) {
      const already = await page.getByText(/already selling|already listed/i).count().catch(() => 0);
      throw new Error(already ? `This seller already sells FSN ${fsn}` : `FSN ${fsn}: START SELLING not shown (product not found or not open for new sellers)`);
    }
    await start.click({ timeout: 15_000 });
    await page.locator('[name=sku_id]').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
  }

  private async fill(page: Page, values: Record<string, string>) {
    const filled: { field: string; value: string }[] = [];
    const missing: { field: string; reason: string }[] = [];
    for (const r of RECIPE) {
      const v = values[r.key];
      if (v === undefined) continue;
      const el = page.locator(`[name="${r.name}"]`).first();
      try {
        // Flipkart hides some fields for some products (e.g. Importer Details when the country is India): skip, note it.
        if (!(await el.count())) { filled.push({ field: r.label, value: `${v} (not asked by Flipkart for this product, skipped)` }); continue; }
        await el.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
        if (r.kind === 'select') {
          const opts = await el.locator('option').allTextContents();
          const want = norm(v);
          const match = opts.find((o) => norm(o) === want) ?? opts.find((o) => norm(o).startsWith(want) && want.length >= 3);
          if (!match) { missing.push({ field: r.label, reason: `"${v}" is not offered (options: ${opts.filter((o) => !/select one/i.test(o)).join(', ').slice(0, 200)})` }); continue; }
          await el.selectOption({ label: match });
        } else if (r.kind === 'date') {
          const iso = /^\d{4}-\d{2}-\d{2}/.exec(v)?.[0];
          if (!iso) { missing.push({ field: r.label, reason: `Date "${v}" not understood` }); continue; }
          await el.fill(iso);
        } else {
          await el.fill(v);
        }
        await el.dispatchEvent('change').catch(() => undefined);
        await el.dispatchEvent('blur').catch(() => undefined);
        filled.push({ field: r.label, value: v });
      } catch (e) {
        missing.push({ field: r.label, reason: (e as Error).message.split('\n')[0].slice(0, 150) });
      }
    }
    // Required fields Flipkart marks with * that are still empty (client left them blank).
    const empty = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('input, select, textarea')) as any[]) {
        if (!el.name || el.type === 'hidden') continue;
        const row = el.closest('div[class*="row"], div[class*="Row"], tr, li, .form-group') ?? el.parentElement?.parentElement;
        const label = (row?.querySelector('label')?.textContent ?? '').trim();
        const blank = el.tagName === 'SELECT' ? /select one/i.test(el.options[el.selectedIndex]?.text ?? '') : !String(el.value ?? '').trim();
        if (label.includes('*') && blank) out.push(label.replace('*', '').trim());
      }
      return out;
    }).catch(() => [] as string[]);
    for (const l of empty) if (!missing.some((m) => m.field.toLowerCase().startsWith(l.toLowerCase().slice(0, 6)))) missing.push({ field: l, reason: 'Required by Flipkart but empty in the client form' });
    return { filled, missing };
  }

  /** Visible validation messages inside the form. */
  private async formErrors(page: Page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('[class*="error" i], [class*="Error"], [role=alert]'))
      .map((e) => (e as HTMLElement).innerText?.trim()).filter((t) => t && t.length > 3 && t.length < 200)).catch(() => [] as string[]);
  }

  /** The form is long: screenshots from top to bottom so the owner sees every value. */
  private async formShots(page: Page, snap: (p: Page, s: string, full?: boolean) => Promise<void>) {
    const first = page.locator('[name=sku_id]').first();
    await first.scrollIntoViewIfNeeded().catch(() => undefined);
    await snap(page, 'Filled form (1)');
    for (const [i, n] of ['shipping_days', 'length_p0', 'country_of_origin'].entries()) {
      await page.locator(`[name="${n}"]`).first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      await snap(page, `Filled form (${i + 2})`);
    }
  }

  /** Evidence → mapping record, pipeline "map" step done (the manager tells the client), audit. Status stays "in QC", never ACTIVE. */
  private async afterSubmit(id: string, input: RunInput, listingRef: string, approver: AuthUser | null) {
    const run = await this.get(id);
    const orgId = run.organizationId;
    await this.db.catalogMapping.updateMany({ where: { organizationId: orgId, serviceRequestId: run.requestId, marketplace: 'FLIPKART' }, data: { status: 'EXACT_VERIFIED', candidateId: input.fsn, result: { by: 'portal-bot', runId: id, submittedAt: new Date().toISOString(), listingRef } } });
    await this.db.task.updateMany({ where: { organizationId: orgId, requestId: run.requestId, status: { in: ['NEW', 'QUEUED', 'IN_PROGRESS'] } }, data: { status: 'UNDER_MARKETPLACE_REVIEW', evidence: { summary: `Offer submitted on Flipkart Seller Hub by the portal bot (run ${id}); waiting for Flipkart QC`, marketplaceRef: listingRef } } });
    await this.db.serviceRequest.updateMany({ where: { id: run.requestId!, organizationId: orgId }, data: { status: 'UNDER_MARKETPLACE_REVIEW' } });
    await this.audit.log({ actor: approver, action: 'portal_bot.mapping_submitted', entity: 'PortalRun', entityId: id, organizationId: orgId, after: { listingRef } });
    // Pipeline: the team's "map" step is done → the manager tells the client it is with Flipkart for QC.
    const pr = await this.db.pipelineRun.findFirst({ where: { organizationId: orgId, pipeline: 'CATALOG_MAPPING', branch: 'FLIPKART_MAPPING', status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
    if (pr && pr.stepIndex === 1) { // step 1 = "SOLLUNA maps the product(s)"
      await this.pipelines.teamAdvance(approver, orgId, pr.id, { fields: { listing_refs: listingRef } }).catch((e) => this.log.warn(`pipeline advance: ${(e as Error).message}`));
    }
    // The next step ("Flipkart confirms") is the team's, so tell the manager directly: submitted, in Flipkart QC, not live yet.
    for (const l of this.pipelines.clientTurnListeners) await l(orgId, `Flipkart mapping (${listingRef}) has been submitted on Flipkart Seller Hub and is now in Flipkart's quality check. Tell the client it is submitted and you will confirm when Flipkart makes it live. Do not say it is live yet.`).catch(() => undefined);
  }
}
