import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { parse } from '../common/zod';
import { StorageService } from '../documents/storage.service';
import { DispatcherService } from '../connectors/dispatcher.service';
import { ManagerAgentService } from '../chat/manager-agent.service';
import type { AuthUser } from '../auth/auth.types';
import { readXlsx } from './xlsx';
import { writeXlsx } from './xlsx-writer';
import { periodDate } from './reports.service';
import { buildLines, bySku, byItem, mergeSettlements, parseOrdersReport, parseSettlement, skuKey, storeLines, suggestItem, summarize, type PlLine, type SettlementFile, type StoredLine } from './flipkart-orders-pl';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const endOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59));
const itemKey = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();
const nextMonth20 = (p: string) => { const d = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 20)); return d.toISOString().slice(0, 10); };

const StartSchema = z.object({ documentIds: z.array(z.string().min(5)).min(2).max(6) });
const CostSchema = z.object({ item: z.string().trim().min(1).max(120), cost: z.number().min(0).max(10_000_000) });
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const RangeSchema = z.object({ from: DATE, to: DATE, mp: z.enum(['FLIPKART', 'AMAZON', 'ALL']).default('FLIPKART') });
const MP_LABEL = { FLIPKART: 'Flipkart', AMAZON: 'Amazon', ALL: 'Amazon + Flipkart' } as const;
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const lastDay = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate();
const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${SHORT[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
/** "October 2026" for a whole month, "October – December 2026" for whole months, else "1 Oct 2026 – 15 Nov 2026". */
function rangeLabel(from: string, to: string) {
  const whole = from.endsWith('-01') && Number(to.slice(8, 10)) === lastDay(to.slice(0, 7));
  if (whole && from.slice(0, 7) === to.slice(0, 7)) return monthName(from.slice(0, 7));
  if (whole) return from.slice(0, 4) === to.slice(0, 4) ? `${MONTHS[Number(from.slice(5, 7)) - 1]} – ${monthName(to.slice(0, 7))}` : `${monthName(from.slice(0, 7))} – ${monthName(to.slice(0, 7))}`;
  return `${dayLabel(from)} – ${dayLabel(to)}`;
}
const MapSchema = z.object({ sku: z.string().trim().min(1).max(200), item: z.string().trim().min(1).max(120), packQty: z.number().int().min(1).max(1000) });

/**
 * Flipkart order-level P&L (owner, 24 Nov 2026). The team (later the portal bot) uploads the month's Orders report and the
 * Settlement reports (the month + next month to the 20th); parsing runs in the background. Purchase cost is entered per
 * ITEM (1L, 500ML …) and every SKU maps to an item × pack size, so a multipack's cost = pack size × item cost.
 */
@Injectable()
export class OrdersPlService implements OnModuleInit {
  private readonly log = new Logger('OrdersPl');
  private busy = false;
  constructor(
    private readonly db: PrismaService, private readonly audit: AuditService, private readonly access: AccessService,
    private readonly storage: StorageService, private readonly dispatch: DispatcherService, private readonly agent: ManagerAgentService,
  ) {}

  onModuleInit() {
    setInterval(() => this.tick().catch((e) => this.log.error(e)), 3000).unref();
  }

  async start(user: AuthUser, orgId: string, period: string, input: unknown) {
    await this.access.assertOrg(user, orgId);
    const { documentIds } = parse(StartSchema, input);
    const docs = await this.db.document.findMany({ where: { id: { in: documentIds }, organizationId: orgId, deletedAt: null } });
    if (docs.length !== new Set(documentIds).size) throw new NotFoundException('One of the files was not found for this client');
    if (docs.filter((d) => d.kind === 'FLIPKART_ORDERS_REPORT').length !== 1) throw new BadRequestException('Add exactly one Flipkart Orders report');
    if (!docs.some((d) => d.kind === 'FLIPKART_SETTLEMENT_REPORT')) throw new BadRequestException('Add the Flipkart Settlement report(s)');
    const row = await this.db.ordersPl.create({ data: { organizationId: orgId, periodMonth: periodDate(period), documentIds, startedById: user.id } });
    await this.audit.log({ actor: user, action: 'report.orders_pl_import', entity: 'OrdersPl', entityId: row.id, organizationId: orgId, after: { period, files: docs.length } });
    setImmediate(() => this.tick().catch((e) => this.log.error(e)));
    return { id: row.id, status: row.status };
  }

  /** Portal bot: the files it downloaded → build the month (draft; the team reviews and publishes). */
  async startSystem(orgId: string, period: string, documentIds: string[]) {
    const row = await this.db.ordersPl.create({ data: { organizationId: orgId, periodMonth: periodDate(period), documentIds, startedById: 'portal-bot' } });
    await this.audit.log({ action: 'report.orders_pl_import', entity: 'OrdersPl', entityId: row.id, organizationId: orgId, after: { period, files: documentIds.length, by: 'portal-bot' } });
    setImmediate(() => this.tick().catch((e) => this.log.error(e)));
    return row.id;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const next = await this.db.ordersPl.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
        if (!next) return;
        const claimed = await this.db.ordersPl.updateMany({ where: { id: next.id, status: 'QUEUED' }, data: { status: 'RUNNING' } });
        if (claimed.count) await this.run(next.id);
      }
    } finally { this.busy = false; }
  }

  private async run(id: string) {
    const row = await this.db.ordersPl.findUniqueOrThrow({ where: { id } });
    const period = row.periodMonth.toISOString().slice(0, 7);
    try {
      const docs = await this.db.document.findMany({ where: { id: { in: row.documentIds } } });
      const ordersDoc = docs.find((d) => d.kind === 'FLIPKART_ORDERS_REPORT')!;
      const orders = parseOrdersReport(readXlsx(await this.storage.get(ordersDoc.fileKey)));
      const settlements: SettlementFile[] = [];
      for (const d of docs.filter((x) => x.kind === 'FLIPKART_SETTLEMENT_REPORT')) settlements.push(parseSettlement(readXlsx(await this.storage.get(d.fileKey))));
      const lines = storeLines(orders, mergeSettlements(settlements), period);
      if (!lines.length) throw new Error(`The Orders report has no orders dated in ${monthName(period)}`);
      const covered = settlements.map((s) => s.to ?? '').sort().pop() ?? '';
      const meta = {
        settlements: settlements.map((s) => ({ from: s.from, to: s.to, rows: s.rows })).sort((a, b) => (a.from ?? '').localeCompare(b.from ?? '')),
        orderRows: lines.length, settledThrough: covered || null, recommendedThrough: nextMonth20(period),
        complete: Boolean(covered) && covered >= nextMonth20(period),
      };
      const earlier = await this.db.ordersPl.findFirst({ where: { organizationId: row.organizationId, periodMonth: row.periodMonth, publishedAt: { not: null }, id: { not: id } } });
      await this.db.ordersPl.update({ where: { id }, data: { status: 'DONE', lines: lines as unknown as Prisma.InputJsonValue, meta, finishedAt: new Date(), ...(earlier ? { publishedAt: new Date(), publishedById: row.startedById } : {}) } });
      const v = await this.compute(row.organizationId, row.periodMonth, lines);
      if (v.summary.missingCost.length) {
        await this.agent.enqueue(row.organizationId, `The ${monthName(period)} Flipkart profit report is being prepared. Purchase cost per unit is missing for ${v.summary.missingCost.length} item(s): ${v.summary.missingCost.slice(0, 15).join('; ')}${v.summary.missingCost.length > 15 ? ' …' : ''}. Ask the client for each item's purchase cost per single unit (₹). They can also enter or edit them in Reports → Purchase cost.`);
      }
    } catch (e) {
      await this.db.ordersPl.update({ where: { id }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 300), finishedAt: new Date() } });
    }
  }

  private async mapping(orgId: string) {
    const rows = await this.db.skuItem.findMany({ where: { organizationId: orgId } });
    const saved = new Map(rows.map((r) => [r.sku, { item: r.item, packQty: r.packQty }]));
    return { saved, get: (sku: string) => saved.get(skuKey(sku)) ?? suggestItem(sku) };
  }

  /** Latest purchase cost per item effective by the month's end (₹ per single item unit). */
  private async costs(orgId: string, periodMonth: Date) {
    const rows = await this.db.productCost.findMany({ where: { organizationId: orgId, effectiveFrom: { lte: endOfMonth(periodMonth) } }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    const map = new Map<string, { cost: number; confirmed: boolean }>();
    for (const r of rows) if (!map.has(itemKey(r.sku))) map.set(itemKey(r.sku), { cost: r.costPaise / 100, confirmed: r.clientConfirmed });
    return map;
  }

  private async compute(orgId: string, periodMonth: Date, stored: StoredLine[]) {
    const map = await this.mapping(orgId);
    const costs = await this.costs(orgId, periodMonth);
    const lines = buildLines(stored, map.get, (item) => costs.get(itemKey(item))?.cost ?? null);
    const items = byItem(lines).map((i) => ({ ...i, costConfirmed: costs.get(itemKey(i.item))?.confirmed ?? null }));
    const skus = bySku(lines).map((s) => ({ ...s, mapped: map.saved.has(skuKey(s.sku)) }));
    return { lines, summary: summarize(lines), items, skus };
  }

  private async row(user: AuthUser, orgId: string, period: string) {
    await this.access.assertOrg(user, orgId);
    return this.db.ordersPl.findFirst({ where: { organizationId: orgId, periodMonth: periodDate(period), ...(user.type === 'CUSTOMER' ? { publishedAt: { not: null } } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  /** Months with a report (client: published only). */
  async months(user: AuthUser, orgId: string) {
    await this.access.assertOrg(user, orgId);
    const rows = await this.db.ordersPl.findMany({ where: { organizationId: orgId, status: 'DONE', ...(user.type === 'CUSTOMER' ? { publishedAt: { not: null } } : {}) }, orderBy: { periodMonth: 'desc' }, select: { periodMonth: true, publishedAt: true } });
    const seen = new Set<string>();
    return rows.map((r) => ({ period: r.periodMonth.toISOString().slice(0, 7), published: Boolean(r.publishedAt) })).filter((r) => !seen.has(r.period) && seen.add(r.period)).map((r) => ({ ...r, label: monthName(r.period) }));
  }

  async view(user: AuthUser, orgId: string, period: string) {
    const row = await this.row(user, orgId, period);
    if (!row) return null;
    const base = { id: row.id, period, label: monthName(period), status: row.status, error: row.error, published: Boolean(row.publishedAt), meta: row.meta };
    if (row.status !== 'DONE' || !row.lines) return base;
    const v = await this.compute(orgId, row.periodMonth, row.lines as unknown as StoredLine[]);
    return { ...base, summary: v.summary, items: v.items, skus: v.skus };
  }

  /**
   * Client view for any period and marketplace (owner, 25 Nov 2026): published months that overlap the period, each with
   * the purchase costs of its own month, order lines filtered to the dates asked. Amazon has no order report yet.
   */
  async range(user: AuthUser, orgId: string, q: unknown) {
    await this.access.assertOrg(user, orgId);
    const d = parse(RangeSchema, q);
    if (d.from > d.to) throw new BadRequestException('"From" date is after "To" date');
    if ((Date.parse(d.to) - Date.parse(d.from)) / 86_400_000 > 400) throw new BadRequestException('Choose a period of up to 13 months');
    const label = rangeLabel(d.from, d.to);
    const v = await this.collect(user, orgId, d.from, d.to, d.mp);
    const available = await this.db.ordersPl.findMany({ where: { organizationId: orgId, status: 'DONE', ...(user.type === 'CUSTOMER' ? { publishedAt: { not: null } } : {}) }, select: { marketplace: true }, distinct: ['marketplace'] });
    const base = { id: `${d.mp}:${d.from}:${d.to}`, period: d.to.slice(0, 7), from: d.from, to: d.to, mp: d.mp, label, published: true, error: null, costPeriod: d.to.slice(0, 7), marketplaces: available.map((a) => a.marketplace) };
    if (!v.rows.length || !v.lines.length) return { ...base, status: 'EMPTY' as const, meta: null };
    return { ...base, status: 'DONE' as const, meta: v.meta, summary: v.summary, items: v.items, skus: v.skus };
  }

  private async collect(user: AuthUser, orgId: string, from: string, to: string, mp: 'FLIPKART' | 'AMAZON' | 'ALL') {
    const rows = await this.db.ordersPl.findMany({
      where: { organizationId: orgId, status: 'DONE', periodMonth: { gte: periodDate(from.slice(0, 7)), lte: periodDate(to.slice(0, 7)) }, ...(mp === 'ALL' ? {} : { marketplace: mp }), ...(user.type === 'CUSTOMER' ? { publishedAt: { not: null } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    const latest = new Map<string, typeof rows[number]>();
    for (const r of rows) { const k = `${r.marketplace}:${r.periodMonth.toISOString()}`; if (!latest.has(k)) latest.set(k, r); }
    const map = await this.mapping(orgId);
    const lines: PlLine[] = [];
    const settlements: { from: string | null; to: string | null; rows: number }[] = [];
    let complete = true;
    let lastCosts: Map<string, { cost: number; confirmed: boolean }> | null = null;
    for (const r of [...latest.values()].sort((a, b) => a.periodMonth.getTime() - b.periodMonth.getTime())) {
      const costs = await this.costs(orgId, r.periodMonth);
      lastCosts = costs;
      const stored = (r.lines as unknown as StoredLine[]).filter((x) => x.d >= from && x.d <= to);
      lines.push(...buildLines(stored, map.get, (item) => costs.get(itemKey(item))?.cost ?? null));
      const m = r.meta as { settlements?: typeof settlements; complete?: boolean } | null;
      settlements.push(...(m?.settlements ?? []));
      if (m && m.complete === false) complete = false;
    }
    const items = byItem(lines).map((i) => ({ ...i, costConfirmed: lastCosts?.get(itemKey(i.item))?.confirmed ?? null }));
    const skus = bySku(lines).map((x) => ({ ...x, mapped: map.saved.has(skuKey(x.sku)) }));
    const uniq = [...new Map(settlements.map((x) => [`${x.from}-${x.to}`, x])).values()].sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
    return { rows: [...latest.values()], lines, summary: summarize(lines), items, skus, meta: { settlements: uniq, complete, settledThrough: uniq.at(-1)?.to ?? null, recommendedThrough: nextMonth20(to.slice(0, 7)) } };
  }

  async publish(user: AuthUser, orgId: string, period: string) {
    if (user.type !== 'STAFF') throw new ForbiddenException();
    const row = await this.row(user, orgId, period);
    if (!row || row.status !== 'DONE') throw new BadRequestException('Import the month first');
    await this.db.ordersPl.update({ where: { id: row.id }, data: { publishedAt: new Date(), publishedById: user.id } });
    await this.audit.log({ actor: user, action: 'report.orders_pl_published', entity: 'OrdersPl', entityId: row.id, organizationId: orgId, after: { period } });
    await this.dispatch.emit({ type: 'report.published', organizationId: orgId, title: `${monthName(period)} Flipkart profit report`, body: 'Your order-wise Flipkart profit for the month is ready in Reports.', data: { period } });
    await this.agent.enqueue(orgId, `The ${monthName(period)} Flipkart profit report is published in Reports (orders of the month, Flipkart's bank settlement minus purchase cost per item). Tell the client briefly; they can edit purchase costs there and the profit updates at once.`);
    return { published: true };
  }

  /** Client or team: purchase cost per single item unit, effective from the report month. */
  async setCost(user: AuthUser, orgId: string, period: string, input: unknown) {
    await this.access.assertOrg(user, orgId);
    const d = parse(CostSchema, input);
    const row = await this.db.productCost.create({ data: { organizationId: orgId, sku: itemKey(d.item), costPaise: Math.round(d.cost * 100), includesGst: false, effectiveFrom: periodDate(period), clientConfirmed: user.type === 'CUSTOMER', enteredById: user.id } });
    await this.audit.log({ actor: user, action: 'report.item_cost', entity: 'ProductCost', entityId: row.id, organizationId: orgId, after: { item: row.sku, cost: d.cost, from: period } });
    return { item: row.sku, cost: d.cost };
  }

  /** Client or team: which item and pack size a SKU is (e.g. "1L X 2 - 3" = 1L × 2). */
  async setSkuItem(user: AuthUser, orgId: string, input: unknown) {
    await this.access.assertOrg(user, orgId);
    const d = parse(MapSchema, input);
    const sku = skuKey(d.sku);
    const row = await this.db.skuItem.upsert({ where: { organizationId_sku: { organizationId: orgId, sku } }, create: { organizationId: orgId, sku, item: itemKey(d.item), packQty: d.packQty, updatedById: user.id }, update: { item: itemKey(d.item), packQty: d.packQty, updatedById: user.id } });
    await this.audit.log({ actor: user, action: 'report.sku_item', entity: 'SkuItem', entityId: row.id, organizationId: orgId, after: { sku, item: row.item, packQty: row.packQty } });
    return { sku: row.sku, item: row.item, packQty: row.packQty };
  }

  /** Excel download (one month, staff or client). */
  async xlsx(user: AuthUser, orgId: string, period: string) {
    const row = await this.row(user, orgId, period);
    if (!row || row.status !== 'DONE' || !row.lines) throw new NotFoundException('No Flipkart profit report for this month');
    const v = await this.compute(orgId, row.periodMonth, row.lines as unknown as StoredLine[]);
    return { fileName: `SOLLUNA-Flipkart-${period}-orders-PL.xlsx`, buf: this.workbook(`Flipkart | ${monthName(period)} orders`, `Orders dated in ${monthName(period)}`, v) };
  }

  /** Excel download of the period / marketplace the client picked. */
  async rangeXlsx(user: AuthUser, orgId: string, q: unknown) {
    const r = await this.range(user, orgId, q);
    if (r.status !== 'DONE') throw new NotFoundException('No profit report for this period');
    const v = await this.collect(user, orgId, r.from, r.to, r.mp);
    return { fileName: `SOLLUNA-${r.mp === 'ALL' ? 'Amazon-Flipkart' : r.mp === 'AMAZON' ? 'Amazon' : 'Flipkart'}-${r.from}-to-${r.to}-PL.xlsx`, buf: this.workbook(`${MP_LABEL[r.mp]} | ${r.label}`, `Orders dated ${r.label}`, v) };
  }

  /** Summary, items, SKUs, every order line, purchase cost list. */
  private workbook(title: string, scope: string, v: { lines: PlLine[]; summary: ReturnType<typeof summarize>; items: ReturnType<typeof byItem>; skus: ReturnType<typeof bySku> }) {
    const s = v.summary; const f = s.funnel; const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    const summary = [
      [`SOLLUNA – ${title}`, null, null, null],
      [`${scope}. Sources: marketplace Orders report + Settlement reports. Amounts in ₹ including GST.`],
      [],
      ['ORDERS', 'Orders', 'Units', '% of orders'],
      ['All orders', f.overall.orders, f.overall.units, 100],
      ['Delivered', f.delivered.orders, f.delivered.units, pct(f.delivered.orders, f.overall.orders)],
      ['   Kept (not returned)', f.notReturned.orders, f.notReturned.units, pct(f.notReturned.orders, f.overall.orders)],
      ['   Customer returns', f.returned.orders, f.returned.units, pct(f.returned.orders, f.overall.orders)],
      ['   Return requested', f.returnRequested.orders, f.returnRequested.units, pct(f.returnRequested.orders, f.overall.orders)],
      ['Not delivered', f.undelivered.orders, f.undelivered.units, pct(f.undelivered.orders, f.overall.orders)],
      ['   Courier return – received back', f.courierReceived.orders, f.courierReceived.units, pct(f.courierReceived.orders, f.overall.orders)],
      ['   Courier return – in transit', f.courierInTransit.orders, f.courierInTransit.units, pct(f.courierInTransit.orders, f.overall.orders)],
      ['   Cancelled', f.cancelled.orders, f.cancelled.units, pct(f.cancelled.orders, f.overall.orders)],
      ['   Rejected', f.rejected.orders, f.rejected.units, pct(f.rejected.orders, f.overall.orders)],
      ['   Ready to ship', f.readyToShip.orders, f.readyToShip.units, pct(f.readyToShip.orders, f.overall.orders)],
      [],
      ['SETTLEMENT', 'Amount (₹)'],
      ['Gross sale', s.settlement.grossSale], ['   Sale (after offers and add-ons)', s.settlement.sale], ['   Offer amount', s.settlement.offer], ['   Customer add-ons', s.settlement.addons], ['   Protection fund (SPF)', s.settlement.spf],
      ['Refunds, cancellations and fees', s.settlement.deductions], ['   Marketplace fee', s.settlement.fee], ['   Taxes (TCS + TDS + GST on fees)', s.settlement.taxes], ['   Refunds (cancellations and returns)', s.settlement.refund],
      ['   My share of offers (information)', s.settlement.myShare],
      ['Total order settlements', s.settlement.total],
      [],
      ['PROFIT', 'Amount (₹)'],
      ['Total order settlements', s.profit.settlement], ['Purchase cost (net units × item cost)', -s.profit.purchase], ['Profit before ads', s.profit.profit], ['Profit % on purchase', s.profit.profitPctOnPurchase],
      [],
      [`Pending settlement: ${s.pending.items} order item(s) not settled yet — counted in orders, not in amounts.`],
      ...(s.missingCost.length ? [[`Purchase cost missing for: ${s.missingCost.join(', ')} — profit for these items is not counted.`]] : []),
    ];
    const items = [['Item', 'Gross units', 'Returned / cancelled', 'Net units', 'Cost per unit', 'Purchase amount', 'Sale amount (bank settlement)', 'Profit'],
      ...v.items.map((i) => [i.item, i.grossUnits, i.returnedUnits, i.netUnits, i.unitCost, i.purchase, i.sale, i.profit]),
      ['TOTAL', v.items.reduce((a, i) => a + i.grossUnits, 0), v.items.reduce((a, i) => a + i.returnedUnits, 0), v.items.reduce((a, i) => a + i.netUnits, 0), null, s.profit.purchase, s.profit.settlement, s.profit.profit]];
    const skus = [['SKU', 'Item', 'Pack qty', 'Gross qty (packs)', 'Gross units (item)', 'Returned / cancelled', 'Net units', 'Purchase amount', 'Sale amount (bank settlement)', 'Profit', 'Note'],
      ...v.skus.map((x) => [x.sku, x.item, x.packQty, x.grossQty, x.grossUnits, x.returnedUnits, x.netUnits, x.purchase, x.sale, x.profit, x.note])];
    const L = (l: PlLine) => [l.orderItemId, l.orderId, l.orderDate, l.status, l.delivered ? 'Y' : 'N', l.returnType ?? '', l.sku, l.item, l.packQty, l.qty, l.itemUnits, l.settled ? 'Y' : 'N', l.grossUnits, l.returnedUnits, l.netUnits, l.sale, l.offer, l.myShare, l.addons, l.spf, l.fee, l.taxes, l.refund, l.bank, l.unitCost, l.purchase, l.profit, l.bucket];
    const orders = [['Order item ID', 'Order ID', 'Order date', 'Status', 'Delivered', 'Return type', 'SKU', 'Item', 'Pack qty', 'Qty', 'Item units', 'Settled', 'Gross units', 'Returned / cancelled', 'Net units', 'Sale', 'Offer', 'My share (info)', 'Customer add-ons', 'SPF', 'Marketplace fee', 'Taxes', 'Refund', 'Bank settlement', 'Unit cost', 'Purchase', 'Profit', 'Bucket'], ...v.lines.map(L)];
    const costList = [['Item', 'Cost per single unit (₹)'], ...v.items.map((i) => [i.item, i.unitCost])];
    return writeXlsx([
      { name: 'Summary', rows: summary, widths: [46, 16, 12, 12], boldRows: [0, 3, 16, 29], moneyCols: [1] },
      { name: 'Item-wise', rows: items, widths: [30, 12, 18, 10, 13, 16, 26, 14], boldRows: [0, items.length - 1], moneyCols: [4, 5, 6, 7] },
      { name: 'SKU-wise', rows: skus, widths: [34, 28, 9, 16, 16, 18, 10, 16, 26, 14, 30], moneyCols: [7, 8, 9] },
      { name: 'Orders', rows: orders, widths: [22, 24, 12, 18, 9, 16, 30, 26, 8, 6, 10, 8, 11, 18, 10, 10, 9, 14, 15, 8, 14, 10, 10, 15, 10, 11, 11, 26], moneyCols: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26] },
      { name: 'Purchase cost', rows: costList, widths: [32, 22], moneyCols: [1] },
    ]);
  }
}
