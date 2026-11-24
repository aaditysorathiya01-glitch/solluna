import type { Cell, Workbook } from './xlsx';

/**
 * Flipkart month P&L by ORDER (owner's method, 24 Nov 2026 — replaces the Flipkart "Profit and Loss Report" that did
 * not match 100%). Sources, all from Seller Hub → Reports Centre:
 *   1. Orders report for the month (one row per order item; the report's own rows, duplicates kept).
 *   2. Settlement report(s) that cover the month's orders: the month itself + the next month to the 20th.
 * Every order item of the month gets its settlement lines summed (split evenly when the Orders report lists the same
 * order item more than once); profit = bank settlement − purchase cost of the net item units. Pure functions, no I/O,
 * amounts in rupees as Flipkart gives them (Inc GST), rounded only for display.
 */

export interface OrderRow { orderItemId: string; orderId: string; orderDate: string; status: string; sku: string; qty: number; delivered: boolean }
export interface SettlementSums { sale: number; offer: number; myShare: number; addons: number; fee: number; taxes: number; offerAdj: number; spf: number; refund: number; bank: number; lines: number }
export interface SettlementFile { from: string | null; to: string | null; byItem: Record<string, SettlementSums>; rows: number }
export interface SkuMapEntry { item: string; packQty: number }

const s = (v: Cell) => (v === null || v === undefined ? '' : String(v)).trim();
const n = (v: Cell) => { const x = typeof v === 'number' ? v : Number(s(v).replace(/,/g, '')); return Number.isFinite(x) ? x : 0; };
/** "OI:438780537868913100", "'438780537868913100" → "438780537868913100". */
export const itemId = (v: Cell) => s(v).replace(/^OI:/i, '').replace(/^'/, '').replace(/"/g, '').trim();
/** Orders report writes SKUs as """SKU:1L - 7""". */
export const cleanSku = (v: Cell) => s(v).replace(/"/g, '').replace(/^SKU:/i, '').trim();
/** Key for matching SKUs (case and spacing ignored). */
export const skuKey = (sku: string) => sku.toUpperCase().replace(/\s+/g, ' ').trim();

function header(rows: Cell[][], want: string[], maxScan = 6) {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const h = rows[i].map((c) => s(c).toLowerCase().replace(/\s+/g, ' '));
    if (want.every((w) => h.some((x) => x.startsWith(w)))) return { at: i, col: (w: string) => h.findIndex((x) => x.startsWith(w)) };
  }
  return null;
}

/** Flipkart Orders report (sheet "Orders"). */
export function parseOrdersReport(wb: Workbook): OrderRow[] {
  const rows = wb['Orders'] ?? Object.values(wb).find((r) => header(r, ['order_item_id', 'order_item_status']));
  const h = rows && header(rows, ['order_item_id', 'order_id', 'order_date', 'order_item_status', 'sku', 'quantity']);
  if (!rows || !h) throw new Error('This is not a Flipkart Orders report (sheet "Orders" with order_item_id, order_date, order_item_status, sku, quantity)');
  const c = { id: h.col('order_item_id'), oid: h.col('order_id'), date: h.col('order_date'), st: h.col('order_item_status'), sku: h.col('sku'), q: h.col('quantity'), del: h.col('order_delivery_date') };
  const out: OrderRow[] = [];
  for (const r of rows.slice(h.at + 1)) {
    const id = itemId(r[c.id]);
    if (!id) continue;
    out.push({ orderItemId: id, orderId: s(r[c.oid]), orderDate: s(r[c.date]).slice(0, 10), status: s(r[c.st]).toUpperCase(), sku: cleanSku(r[c.sku]), qty: n(r[c.q]) || 1, delivered: c.del >= 0 && Boolean(s(r[c.del])) });
  }
  if (!out.length) throw new Error('The Orders report has no order rows');
  return out;
}

const SETTLE_COLS: [keyof SettlementSums, string][] = [
  ['bank', 'bank settlement value'], ['sale', 'sale amount'], ['offer', 'total offer amount'], ['myShare', 'my share'], ['addons', 'customer add-ons amount (rs.)'],
  ['fee', 'marketplace fee (rs.)'], ['taxes', 'taxes (rs.)'], ['offerAdj', 'offer adjustments (rs.)'], ['spf', 'protection fund'], ['refund', 'refund'],
];

/** Flipkart Settlement report (sheet "Orders": group row, header row, blank row, data). Duplicate lines are ignored once. */
export function parseSettlement(wb: Workbook): SettlementFile {
  const rows = wb['Orders'];
  const h = rows && header(rows, ['order item id', 'bank settlement value', 'sale amount', 'refund']);
  if (!rows || !h) throw new Error('This is not a Flipkart Settlement report (sheet "Orders" with Order item ID, Bank Settlement Value, Sale Amount, Refund)');
  const idCol = h.col('order item id');
  const cols = SETTLE_COLS.map(([k, w]) => [k, h.col(w)] as const);
  for (const [k, i] of cols) if (i < 0) throw new Error(`Settlement report column missing: ${k}`);
  const byItem: Record<string, SettlementSums> = {};
  const seen = new Set<string>();
  let count = 0;
  for (const r of rows.slice(h.at + 1)) {
    const id = itemId(r[idCol]);
    if (!/^\d{6,}$/.test(id)) continue;
    const sig = JSON.stringify(r);
    if (seen.has(sig)) continue;
    seen.add(sig);
    count++;
    const t = (byItem[id] ??= { sale: 0, offer: 0, myShare: 0, addons: 0, fee: 0, taxes: 0, offerAdj: 0, spf: 0, refund: 0, bank: 0, lines: 0 });
    for (const [k, i] of cols) t[k] += n(r[i]);
    t.lines++;
  }
  const summary = wb['Summary of report'] ?? [];
  const dur = summary.map((r) => r.map(s)).find((r) => r.some((x) => /payment duration/i.test(x)));
  const m = /(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/.exec(dur?.join(' ') ?? '');
  return { from: m?.[1] ?? null, to: m?.[2] ?? null, byItem, rows: count };
}

/** Merges settlement files; a line repeated in two files is counted once per file it truly belongs to (files must not overlap in dates). */
export function mergeSettlements(files: SettlementFile[]) {
  const sorted = [...files].sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], cur = sorted[i];
    if (prev.to && cur.from && cur.from <= prev.to) throw new Error(`Settlement reports overlap (${prev.from}–${prev.to} and ${cur.from}–${cur.to}); upload non-overlapping periods`);
  }
  const all: Record<string, SettlementSums> = {};
  for (const f of files) for (const [id, v] of Object.entries(f.byItem)) {
    const t = (all[id] ??= { sale: 0, offer: 0, myShare: 0, addons: 0, fee: 0, taxes: 0, offerAdj: 0, spf: 0, refund: 0, bank: 0, lines: 0 });
    for (const k of Object.keys(t) as (keyof SettlementSums)[]) t[k] += v[k];
  }
  return all;
}

/**
 * Suggested item + pack size from a seller SKU (owner's naming): "1L X 2 - 3" → 1L × 2, "ARALDITE-STD-36GM-6" → ARALDITE STD 36GM,
 * "GP.PRO-BLACK-5" → GP PRO BLACK, "INSTA SHINE SPONGE X 10 -2" → INSTA SHINE SPONGE × 10. The client can change it.
 */
export function suggestItem(sku: string): SkuMapEntry {
  let t = sku.toUpperCase().trim();
  t = t.replace(/\s*-\s*\d+\s*$/, '');            // trailing listing number "- 12" / "-6"
  let packQty = 1;
  const pack = /\s+X\s*(\d+)\s*$/.exec(t);
  if (pack) { packQty = Number(pack[1]); t = t.slice(0, pack.index); }
  if (!/\s/.test(t)) t = t.replace(/[.\-_]+/g, ' ');  // "ARALDITE-STD-36GM" style
  else t = t.replace(/\./g, ' ');
  return { item: t.replace(/\s+/g, ' ').trim(), packQty };
}

export type Bucket = 'Not-Returned' | 'Returned' | 'Return Requested' | 'Courier Return - Received' | 'Courier Return - In Transit' | 'Cancelled' | 'Rejected' | 'Ready To Ship';

export interface PlLine {
  orderItemId: string; orderId: string; orderDate: string; status: string; delivered: boolean; returnType: 'Customer Return' | 'Logistics Return' | null;
  sku: string; item: string; packQty: number; qty: number; itemUnits: number; settled: boolean;
  grossQty: number; grossUnits: number; returnedUnits: number; netUnits: number;
  sale: number; offer: number; myShare: number; addons: number; spf: number; fee: number; taxes: number; refund: number; bank: number;
  unitCost: number | null; purchase: number; profit: number; bucket: Bucket;
}

export function bucketOf(status: string, delivered: boolean): Bucket {
  if (status === 'CANCELLED') return 'Cancelled';
  if (status === 'REJECTED') return 'Rejected';
  if (status === 'READY_TO_SHIP') return 'Ready To Ship';
  if (status === 'DELIVERED') return 'Not-Returned';
  if (delivered) return status === 'RETURNED' ? 'Returned' : 'Return Requested';
  return status === 'RETURNED' ? 'Courier Return - Received' : 'Courier Return - In Transit';
}

const RETURNISH = new Set(['CANCELLED', 'RETURNED', 'RETURN_REQUESTED']);

/** Stored per order item (the heavy part); costs and SKU mapping are applied at read time so edits show at once. */
export interface StoredLine { id: string; oid: string; d: string; st: string; del: 0 | 1; sku: string; q: number; share: number; set: 0 | 1;
  sale: number; offer: number; my: number; add: number; spf: number; fee: number; tax: number; ref: number; fk: number; refAll: number }

export function storeLines(orders: OrderRow[], settle: Record<string, SettlementSums>, period: string): StoredLine[] {
  const month = orders.filter((o) => o.orderDate.startsWith(period));
  const dup: Record<string, number> = {};
  for (const o of month) dup[o.orderItemId] = (dup[o.orderItemId] ?? 0) + 1;
  // Same order item listed twice (one unit delivered, one returned): amounts split evenly, but the whole refund goes to
  // the first returned / return-requested row (owner's sheet, 24 Nov 2026).
  const refundRow: Record<string, number> = {};
  month.forEach((o, i) => { if (dup[o.orderItemId] > 1 && refundRow[o.orderItemId] === undefined && RETURNISH.has(o.status)) refundRow[o.orderItemId] = i; });
  return month.map((o, i) => {
    const t = settle[o.orderItemId];
    const k = 1 / dup[o.orderItemId];
    const v = (x: number | undefined, share = k) => Math.round((x ?? 0) * share * 1000) / 1000;
    const rr = refundRow[o.orderItemId];
    const refShare = rr === undefined ? k : rr === i ? 1 : 0;
    return { id: o.orderItemId, oid: o.orderId, d: o.orderDate, st: o.status, del: o.delivered ? 1 : 0, sku: o.sku, q: o.qty, share: k, set: t ? 1 : 0,
      sale: v(t?.sale), offer: v(t?.offer), my: v(t?.myShare), add: v(t?.addons), spf: v(t?.spf), fee: v(t?.fee), tax: v(t?.taxes), ref: v(t?.refund, refShare), fk: v(t?.bank), refAll: v(t?.refund, 1) };
  });
}

export function buildLines(stored: StoredLine[], map: (sku: string) => SkuMapEntry, cost: (item: string) => number | null): PlLine[] {
  return stored.map((x) => {
    const m = map(x.sku);
    const itemUnits = m.packQty * x.q;
    const settled = x.set === 1;
    const grossUnits = settled ? itemUnits : 0;
    const returnedUnits = settled && RETURNISH.has(x.st) ? itemUnits : 0;
    const netUnits = grossUnits - returnedUnits;
    const bank = x.sale + x.offer + x.add + x.spf + x.fee + x.tax + x.ref;
    const unitCost = cost(m.item);
    const purchase = netUnits * (unitCost ?? 0);
    return {
      orderItemId: x.id, orderId: x.oid, orderDate: x.d, status: x.st, delivered: x.del === 1,
      // Settled and returned (by status or by a refund); a cancellation refund is not a return.
      returnType: x.set && x.st !== 'CANCELLED' && ((x.refAll ?? x.ref) < 0 || x.st === 'RETURNED' || x.st === 'RETURN_REQUESTED') ? (x.del ? 'Customer Return' : 'Logistics Return') : null,
      sku: x.sku, item: m.item, packQty: m.packQty, qty: x.q, itemUnits, settled, grossQty: settled ? x.q : 0, grossUnits, returnedUnits, netUnits,
      sale: x.sale, offer: x.offer, myShare: x.my, addons: x.add, spf: x.spf, fee: x.fee, taxes: x.tax, refund: x.ref, bank,
      unitCost, purchase, profit: settled ? bank - purchase : 0, bucket: bucketOf(x.st, x.del === 1),
    };
  });
}

const sum = (xs: PlLine[], f: (l: PlLine) => number) => xs.reduce((a, l) => a + f(l), 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

export function summarize(lines: PlLine[]) {
  const by = (b: Bucket) => lines.filter((l) => l.bucket === b);
  const grp = (xs: PlLine[]) => ({ orders: xs.length, units: sum(xs, (l) => l.qty) });
  const delivered = [...by('Not-Returned'), ...by('Returned'), ...by('Return Requested')];
  const courier = [...by('Courier Return - Received'), ...by('Courier Return - In Transit')];
  const undelivered = [...courier, ...by('Cancelled'), ...by('Rejected'), ...by('Ready To Ship')];
  const funnel = {
    overall: grp(lines), delivered: grp(delivered), notReturned: grp(by('Not-Returned')), returned: grp(by('Returned')), returnRequested: grp(by('Return Requested')),
    undelivered: grp(undelivered), courierReturn: grp(courier), courierReceived: grp(by('Courier Return - Received')), courierInTransit: grp(by('Courier Return - In Transit')),
    cancelled: grp(by('Cancelled')), rejected: grp(by('Rejected')), readyToShip: grp(by('Ready To Ship')),
  };
  const sale = sum(lines, (l) => l.sale), offer = sum(lines, (l) => l.offer), addons = sum(lines, (l) => l.addons), spf = sum(lines, (l) => l.spf);
  const fee = sum(lines, (l) => l.fee), taxes = sum(lines, (l) => l.taxes), refund = sum(lines, (l) => l.refund), myShare = sum(lines, (l) => l.myShare);
  const grossSale = sale + offer + addons + spf;
  const deductions = fee + taxes + refund;
  const settlement = grossSale + deductions;
  const purchase = sum(lines, (l) => l.purchase);
  const profit = settlement - purchase;
  const pending = lines.filter((l) => !l.settled && !['CANCELLED', 'REJECTED'].includes(l.status));
  const missingCost = [...new Set(lines.filter((l) => l.netUnits > 0 && l.unitCost === null).map((l) => l.item))].sort();
  return {
    funnel,
    settlement: { grossSale: r2(grossSale), sale: r2(sale), offer: r2(offer), addons: r2(addons), spf: r2(spf), deductions: r2(deductions), myShare: r2(myShare), fee: r2(fee), taxes: r2(taxes), refund: r2(refund), total: r2(settlement) },
    profit: { settlement: r2(settlement), purchase: r2(purchase), profit: r2(profit), profitPctOnPurchase: purchase ? r2((profit / purchase) * 100) : null },
    pending: { items: pending.length, units: sum(pending, (l) => l.qty) },
    missingCost,
    check: r2(settlement - sum(lines, (l) => l.bank)),
  };
}

export function byItem(lines: PlLine[]) {
  const m = new Map<string, { item: string; grossUnits: number; returnedUnits: number; netUnits: number; purchase: number; sale: number; profit: number; unitCost: number | null }>();
  for (const l of lines) {
    const t = m.get(l.item) ?? { item: l.item, grossUnits: 0, returnedUnits: 0, netUnits: 0, purchase: 0, sale: 0, profit: 0, unitCost: l.unitCost };
    t.grossUnits += l.grossUnits; t.returnedUnits += l.returnedUnits; t.netUnits += l.netUnits; t.purchase += l.purchase; if (l.settled) t.sale += l.bank;
    m.set(l.item, t);
  }
  return [...m.values()].map((t) => ({ ...t, purchase: r2(t.purchase), sale: r2(t.sale), profit: r2(t.sale - t.purchase) })).sort((a, b) => a.item.localeCompare(b.item));
}

export function bySku(lines: PlLine[]) {
  const m = new Map<string, { sku: string; item: string; packQty: number; grossQty: number; grossUnits: number; returnedUnits: number; netUnits: number; purchase: number; sale: number; profit: number; orders: number; note: string }>();
  for (const l of lines) {
    const t = m.get(l.sku) ?? { sku: l.sku, item: l.item, packQty: l.packQty, grossQty: 0, grossUnits: 0, returnedUnits: 0, netUnits: 0, purchase: 0, sale: 0, profit: 0, orders: 0, note: '' };
    t.grossQty += l.grossQty; t.grossUnits += l.grossUnits; t.returnedUnits += l.returnedUnits; t.netUnits += l.netUnits; t.purchase += l.purchase; if (l.settled) t.sale += l.bank; t.orders++;
    m.set(l.sku, t);
  }
  return [...m.values()].map((t) => {
    const profit = t.sale - t.purchase;
    const note = t.netUnits > 0 && profit < 0 ? 'Loss — check SKU / price' : t.grossUnits === 0 && t.orders > 0 ? 'Settlement pending / all cancelled' : '';
    return { ...t, purchase: r2(t.purchase), sale: r2(t.sale), profit: r2(profit), note };
  }).sort((a, b) => a.item.localeCompare(b.item) || a.sku.localeCompare(b.sku, undefined, { numeric: true }));
}
