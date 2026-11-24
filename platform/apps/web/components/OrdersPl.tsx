'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { uploadFile } from './Chat';

/**
 * Flipkart order-wise profit dashboard (owner, 24 Nov 2026): the month's orders → Flipkart bank settlement → minus purchase
 * cost per item. Purchase cost and SKU → item mapping are editable here and the numbers update at once.
 */
interface Grp { orders: number; units: number }
interface ItemRow { item: string; grossUnits: number; returnedUnits: number; netUnits: number; purchase: number; sale: number; profit: number; unitCost: number | null; costConfirmed: boolean | null }
interface SkuRow { sku: string; item: string; packQty: number; grossQty: number; grossUnits: number; returnedUnits: number; netUnits: number; purchase: number; sale: number; profit: number; orders: number; note: string; mapped: boolean }
interface View {
  id: string; period: string; label: string; status: string; error: string | null; published: boolean;
  meta?: { settlements: { from: string | null; to: string | null; rows: number }[]; settledThrough: string | null; recommendedThrough: string; complete: boolean } | null;
  summary?: {
    funnel: Record<'overall' | 'delivered' | 'notReturned' | 'returned' | 'returnRequested' | 'undelivered' | 'courierReturn' | 'courierReceived' | 'courierInTransit' | 'cancelled' | 'rejected' | 'readyToShip', Grp>;
    settlement: { grossSale: number; sale: number; offer: number; addons: number; spf: number; deductions: number; myShare: number; fee: number; taxes: number; refund: number; total: number };
    profit: { settlement: number; purchase: number; profit: number; profitPctOnPurchase: number | null };
    pending: { items: number; units: number }; missingCost: string[];
  };
  items?: ItemRow[]; skus?: SkuRow[];
}

const inr = (v: number | null | undefined, dp = 0) => v === null || v === undefined ? '—' : `${v < 0 ? '−' : ''}₹${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const num = (v: number) => v.toLocaleString('en-IN');
const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const p1 = (v: number) => `${v.toFixed(1)}%`;
const dmy = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');

export interface OrdersPlPaths { view: string; xlsx: string; cost: string; sku: string }
export const clientPaths = (period: string): OrdersPlPaths => ({ view: `/reports/orders-pl?period=${period}`, xlsx: `/api/reports/orders-pl.xlsx?period=${period}`, cost: `/reports/orders-pl/cost?period=${period}`, sku: '/reports/orders-pl/sku-item' });
export const opsPaths = (orgId: string, period: string): OrdersPlPaths => ({ view: `/ops/reports/${orgId}/${period}/orders-pl`, xlsx: `/api/ops/reports/${orgId}/${period}/orders-pl.xlsx`, cost: `/ops/reports/${orgId}/${period}/orders-pl/cost`, sku: `/ops/reports/${orgId}/orders-pl/sku-item` });

/** Client Reports: month picker + the dashboard. */
export function ClientFlipkartProfit() {
  const [months, setMonths] = useState<{ period: string; label: string }[] | null>(null);
  const [period, setPeriod] = useState('');
  useEffect(() => { api<{ period: string; label: string }[]>('/reports/orders-pl/months').then((m) => { setMonths(m); if (m[0]) setPeriod(m[0].period); }).catch(() => setMonths([])); }, []);
  if (!months) return null;
  if (!months.length) return (
    <section className="card p-6" aria-label="Flipkart profit">
      <h2 className="font-display text-2xl">Flipkart profit</h2>
      <p className="mt-1 text-sm text-ink-3">Your order-wise Flipkart profit appears here once your manager publishes the month (after Flipkart settles the month&rsquo;s orders, around the 20th of the next month).</p>
    </section>
  );
  return <OrdersPlDashboard paths={clientPaths(period)} months={months} period={period} onPeriod={setPeriod} />;
}

export function OrdersPlDashboard({ paths, months, period, onPeriod, staffActions, reloadKey }: {
  paths: OrdersPlPaths; months?: { period: string; label: string }[]; period: string; onPeriod?: (p: string) => void; staffActions?: (v: View, reload: () => void) => React.ReactNode; reloadKey?: number;
}) {
  const [v, setV] = useState<View | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); api<View | null>(paths.view).then(setV).catch((e) => { setV(null); setErr((e as Error).message); }); }, [paths.view]);
  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => { if (v && (v.status === 'QUEUED' || v.status === 'RUNNING')) { const t = setTimeout(load, 2000); return () => clearTimeout(t); } }, [v, load]);

  if (v === undefined) return <section className="card p-6 text-sm text-ink-3">Loading Flipkart profit…</section>;
  if (!v) return err ? <p className="text-sm text-red-700">{err}</p> : null;
  if (v.status !== 'DONE' || !v.summary) return (
    <section className="card p-6 text-sm" aria-label="Flipkart profit">
      {v.status === 'FAILED' ? <p className="text-red-700">Could not read the files: {v.error}</p> : <p className="text-ink-3">Reading the Flipkart files for {v.label}…</p>}
      {staffActions?.(v, load)}
    </section>
  );
  const s = v.summary; const f = s.funnel;
  const marginOnSale = pct(s.profit.profit, s.profit.settlement);
  return (
    <section className="space-y-5" aria-label="Flipkart profit" data-testid="orders-pl">
      {/* Header */}
      <div className="overflow-hidden rounded-2xl bg-ink text-ivory">
        <div className="flex flex-wrap items-end justify-between gap-4 p-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-sun-2">Flipkart · orders of the month</p>
            <h2 className="font-display text-3xl">{v.label} profit</h2>
            <p className="mt-1 text-xs text-ivory/70">
              Orders dated in {v.label} · Flipkart bank settlement {v.meta?.settlements.map((x) => `${dmy(x.from)}–${dmy(x.to)}`).join(' + ')} · amounts incl. GST
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {months && months.length > 1 && onPeriod && (
              <select aria-label="Month" className="rounded-xl border border-ivory/20 bg-ink-2 px-3 py-2 text-sm text-ivory" value={period} onChange={(e) => onPeriod(e.target.value)}>
                {months.map((m) => <option key={m.period} value={m.period}>{m.label}</option>)}
              </select>
            )}
            <a className="inline-flex items-center gap-2 rounded-xl bg-sun px-4 py-2 text-sm font-semibold text-ink hover:bg-sun-2" href={paths.xlsx} data-testid="orders-pl-xlsx">Download Excel</a>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-ivory/10 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Orders" value={num(f.overall.orders)} sub={`${num(f.overall.units)} units`} />
          <Kpi label="Delivered & kept" value={p1(pct(f.notReturned.orders, f.overall.orders))} sub={`${num(f.notReturned.orders)} orders`} />
          <Kpi label="Returns + RTO" value={p1(pct(f.returned.orders + f.returnRequested.orders + f.courierReturn.orders, f.overall.orders))} sub={`${num(f.returned.orders + f.returnRequested.orders + f.courierReturn.orders)} orders`} tone="warn" />
          <Kpi label="Bank settlement" value={inr(s.profit.settlement)} sub="after Flipkart fees & refunds" />
          <Kpi label="Purchase cost" value={inr(s.profit.purchase)} sub="net units × item cost" />
          <Kpi label="Profit before ads" value={inr(s.profit.profit)} sub={s.profit.profitPctOnPurchase === null ? '—' : `${s.profit.profitPctOnPurchase}% on purchase · ${p1(marginOnSale)} of settlement`} tone={s.profit.profit >= 0 ? 'good' : 'bad'} />
        </div>
      </div>

      {(s.missingCost.length > 0 || s.pending.items > 0 || v.meta?.complete === false) && (
        <div className="space-y-1 rounded-2xl border border-sun/40 bg-sun/10 p-4 text-sm text-ink-2" role="status">
          {s.missingCost.length > 0 && <p><b>Purchase cost missing</b> for {s.missingCost.join(', ')}: their profit is not counted yet. Add the cost below.</p>}
          {s.pending.items > 0 && <p><b>{num(s.pending.items)} order item(s)</b> are not settled by Flipkart yet: counted in orders, not in amounts.</p>}
          {v.meta?.complete === false && <p>Settlements are included up to {dmy(v.meta.settledThrough)}; the month is complete once settlements up to {dmy(v.meta.recommendedThrough)} are added.</p>}
        </div>
      )}
      {staffActions?.(v, load)}

      <div className="grid gap-5 lg:grid-cols-2">
        <OrderFunnel f={f} />
        <SettlementCard s={s} />
      </div>

      <ItemTable items={v.items ?? []} costPath={paths.cost} onSaved={load} />
      <SkuTable skus={v.skus ?? []} skuPath={paths.sku} onSaved={load} />
    </section>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'good' | 'bad' | 'warn' }) {
  const c = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-sun-2' : 'text-ivory';
  return (
    <div className="bg-ink p-4">
      <p className="text-[11px] uppercase tracking-wider text-ivory/60">{label}</p>
      <p className={`mt-1 font-display text-2xl tabular-nums ${c}`}>{value}</p>
      <p className="text-[11px] text-ivory/60">{sub}</p>
    </div>
  );
}

function OrderFunnel({ f }: { f: NonNullable<View['summary']>['funnel'] }) {
  const total = f.overall.orders;
  const parts = [
    { k: 'Delivered, kept', g: f.notReturned, c: 'bg-emerald-600' },
    { k: 'Customer returned', g: f.returned, c: 'bg-amber-500' },
    { k: 'Return requested', g: f.returnRequested, c: 'bg-amber-300' },
    { k: 'Courier return, received', g: f.courierReceived, c: 'bg-orange-600' },
    { k: 'Courier return, in transit', g: f.courierInTransit, c: 'bg-orange-300' },
    { k: 'Cancelled', g: f.cancelled, c: 'bg-ink-3' },
    { k: 'Rejected', g: f.rejected, c: 'bg-red-500' },
    { k: 'Ready to ship', g: f.readyToShip, c: 'bg-moon' },
  ];
  return (
    <div className="card p-5" aria-label="Orders">
      <div className="flex items-baseline justify-between"><h3 className="font-semibold">Where the orders went</h3><span className="text-xs text-ink-3">{num(total)} orders · {num(f.overall.units)} units</span></div>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-ivory-2" aria-hidden>
        {parts.map((p) => p.g.orders > 0 && <div key={p.k} className={p.c} style={{ width: `${pct(p.g.orders, total)}%` }} title={`${p.k}: ${p.g.orders}`} />)}
      </div>
      <table className="mt-4 w-full text-sm">
        <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-3"><th className="pb-2 font-semibold">Status</th><th className="pb-2 text-right font-semibold">Orders</th><th className="pb-2 text-right font-semibold">Units</th><th className="pb-2 text-right font-semibold">Share</th></tr></thead>
        <tbody className="tabular-nums">
          <tr className="border-t border-ink/5 font-semibold"><td className="py-1.5">Delivered</td><td className="text-right">{num(f.delivered.orders)}</td><td className="text-right">{num(f.delivered.units)}</td><td className="text-right">{p1(pct(f.delivered.orders, total))}</td></tr>
          {parts.slice(0, 3).map((p) => <Row key={p.k} p={p} total={total} />)}
          <tr className="border-t border-ink/5 font-semibold"><td className="py-1.5">Not delivered</td><td className="text-right">{num(f.undelivered.orders)}</td><td className="text-right">{num(f.undelivered.units)}</td><td className="text-right">{p1(pct(f.undelivered.orders, total))}</td></tr>
          {parts.slice(3).map((p) => <Row key={p.k} p={p} total={total} />)}
        </tbody>
      </table>
    </div>
  );
}
function Row({ p, total }: { p: { k: string; g: Grp; c: string }; total: number }) {
  return <tr className="border-t border-ink/5 text-ink-2"><td className="py-1.5 pl-3"><span className={`mr-2 inline-block h-2 w-2 rounded-full ${p.c}`} />{p.k}</td><td className="text-right">{num(p.g.orders)}</td><td className="text-right">{num(p.g.units)}</td><td className="text-right">{p1(pct(p.g.orders, total))}</td></tr>;
}

function SettlementCard({ s }: { s: NonNullable<View['summary']> }) {
  const st = s.settlement; const max = Math.max(st.grossSale, 1);
  const lines: { k: string; v: number; sub?: boolean; strong?: boolean; tone?: string }[] = [
    { k: 'Gross sale', v: st.grossSale, strong: true },
    { k: 'Sale (after offers & add-ons)', v: st.sale, sub: true }, { k: 'Offer amount', v: st.offer, sub: true }, { k: 'Customer add-ons', v: st.addons, sub: true }, { k: 'Protection fund (SPF)', v: st.spf, sub: true },
    { k: 'Marketplace fee', v: st.fee, tone: 'neg' }, { k: 'Taxes (TCS, TDS, GST on fees)', v: st.taxes, tone: 'neg' }, { k: 'Refunds (cancellations & returns)', v: st.refund, tone: 'neg' },
    { k: 'Bank settlement', v: st.total, strong: true },
    { k: 'Purchase cost', v: -s.profit.purchase, tone: 'neg' },
    { k: 'Profit before ads', v: s.profit.profit, strong: true, tone: s.profit.profit >= 0 ? 'pos' : 'neg' },
  ];
  return (
    <div className="card p-5" aria-label="Settlement">
      <div className="flex items-baseline justify-between"><h3 className="font-semibold">From sale to profit</h3><span className="text-xs text-ink-3">₹, incl. GST</span></div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {lines.map((l) => (
          <li key={l.k} className={`${l.strong ? 'border-t border-ink/10 pt-1.5 font-semibold' : ''} ${l.sub ? 'pl-3 text-ink-3' : ''}`}>
            <div className="flex items-center justify-between gap-3">
              <span>{l.k}</span>
              <span className={`tabular-nums ${l.tone === 'neg' ? 'text-red-700' : l.tone === 'pos' ? 'text-emerald-700' : ''}`}>{inr(l.v, 2)}</span>
            </div>
            {!l.sub && <div className="mt-1 h-1.5 rounded-full bg-ivory-2"><div className={`h-1.5 rounded-full ${l.tone === 'neg' ? 'bg-red-300' : l.tone === 'pos' ? 'bg-emerald-500' : 'bg-sun'}`} style={{ width: `${Math.min(100, (Math.abs(l.v) / max) * 100)}%` }} /></div>}
          </li>
        ))}
      </ul>
      {st.myShare !== 0 && <p className="mt-2 text-xs text-ink-3">Your share of offers (information): {inr(st.myShare, 2)}</p>}
    </div>
  );
}

function ItemTable({ items, costPath, onSaved }: { items: ItemRow[]; costPath: string; onSaved: () => void }) {
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const maxProfit = Math.max(...items.map((i) => Math.abs(i.profit)), 1);
  async function save(item: string) {
    const raw = (edit[item] ?? '').trim();
    if (raw === '' || !Number.isFinite(Number(raw))) return setMsg({ err: `Enter the purchase cost for ${item}` });
    try { await api(costPath, { method: 'PUT', body: { item, cost: Number(raw) } }); setEdit((e) => { const n = { ...e }; delete n[item]; return n; }); setMsg({ ok: `${item}: cost saved, profit updated.` }); onSaved(); }
    catch (e) { setMsg({ err: (e as Error).message }); }
  }
  const tot = items.reduce((a, i) => ({ net: a.net + i.netUnits, p: a.p + i.purchase, s: a.s + i.sale, pr: a.pr + i.profit }), { net: 0, p: 0, s: 0, pr: 0 });
  return (
    <div className="card overflow-hidden" aria-label="Item-wise profit">
      <div className="flex flex-wrap items-end justify-between gap-2 p-5 pb-3">
        <div><h3 className="font-semibold">Item-wise profit &amp; purchase cost</h3><p className="text-xs text-ink-3">Cost per single unit (a pack of 2 counts 2 units). Edit a cost and the whole report updates.</p></div>
        {msg.ok && <p className="text-xs text-emerald-700" role="status">{msg.ok}</p>}{msg.err && <p className="text-xs text-red-700" role="alert">{msg.err}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-ivory text-left text-[11px] uppercase tracking-wider text-ink-3">
            <tr><th className="px-5 py-2 font-semibold">Item</th><th className="py-2 text-right font-semibold">Net units</th><th className="py-2 pl-4 font-semibold">Cost / unit (₹)</th><th className="py-2 text-right font-semibold">Purchase</th><th className="py-2 text-right font-semibold">Bank settlement</th><th className="px-5 py-2 text-right font-semibold">Profit</th></tr>
          </thead>
          <tbody className="tabular-nums">
            {items.map((i) => {
              const editing = edit[i.item] !== undefined; const missing = i.unitCost === null && i.netUnits > 0;
              return (
                <tr key={i.item} className={`border-t border-ink/5 ${missing ? 'bg-sun/10' : ''}`} data-testid={`item-${i.item}`}>
                  <td className="px-5 py-2 font-medium">{i.item}<span className="block text-[11px] font-normal text-ink-3">{num(i.grossUnits)} sold · {num(i.returnedUnits)} returned / cancelled</span></td>
                  <td className="text-right">{num(i.netUnits)}</td>
                  <td className="py-1.5 pl-4">
                    {editing ? (
                      <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void save(i.item); }}>
                        <input aria-label={`Cost of ${i.item}`} autoFocus type="number" step="0.01" min="0" className="w-24 rounded-lg border border-ink/20 px-2 py-1 text-sm" value={edit[i.item]} onChange={(e) => setEdit((x) => ({ ...x, [i.item]: e.target.value }))} />
                        <button className="rounded-lg bg-ink px-2 py-1 text-xs font-semibold text-ivory">Save</button>
                        <button type="button" className="text-xs text-ink-3" onClick={() => setEdit((x) => { const n = { ...x }; delete n[i.item]; return n; })}>Cancel</button>
                      </form>
                    ) : (
                      <button className={`rounded-lg border px-2 py-1 text-xs ${missing ? 'border-sun bg-white font-semibold text-sun-3' : 'border-ink/10 hover:border-ink/40'}`} onClick={() => setEdit((x) => ({ ...x, [i.item]: i.unitCost === null ? '' : String(i.unitCost) }))}>
                        {i.unitCost === null ? 'Add cost' : `${inr(i.unitCost, 2)} ✎`}
                      </button>
                    )}
                  </td>
                  <td className="text-right">{inr(i.purchase)}</td>
                  <td className="text-right">{inr(i.sale)}</td>
                  <td className="px-5 text-right">
                    <span className={i.profit >= 0 ? 'text-emerald-700' : 'text-red-700'}>{inr(i.profit)}</span>
                    <div className="ml-auto mt-1 h-1 w-24 rounded-full bg-ivory-2"><div className={`h-1 rounded-full ${i.profit >= 0 ? 'bg-emerald-500' : 'bg-red-400'}`} style={{ width: `${(Math.abs(i.profit) / maxProfit) * 100}%` }} /></div>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-ink/10 font-semibold"><td className="px-5 py-2">Total</td><td className="text-right">{num(tot.net)}</td><td /><td className="text-right">{inr(tot.p)}</td><td className="text-right">{inr(tot.s)}</td><td className={`px-5 text-right ${tot.pr >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{inr(tot.pr)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SkuTable({ skus, skuPath, onSaved }: { skus: SkuRow[]; skuPath: string; onSaved: () => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<{ sku: string; item: string; packQty: string } | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const flagged = skus.filter((s) => s.note).length;
  const rows = useMemo(() => { const t = q.trim().toUpperCase(); return skus.filter((s) => !t || s.sku.toUpperCase().includes(t) || s.item.includes(t)); }, [skus, q]);
  async function save() {
    if (!edit) return;
    try { await api(skuPath, { method: 'PUT', body: { sku: edit.sku, item: edit.item, packQty: Number(edit.packQty) } }); setMsg({ ok: `${edit.sku} → ${edit.item.toUpperCase()} × ${edit.packQty}` }); setEdit(null); onSaved(); }
    catch (e) { setMsg({ err: (e as Error).message }); }
  }
  return (
    <div className="card overflow-hidden" aria-label="SKU-wise">
      <button className="flex w-full flex-wrap items-center justify-between gap-2 p-5 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div><h3 className="font-semibold">SKU-wise detail &amp; item mapping</h3><p className="text-xs text-ink-3">{skus.length} SKUs{flagged ? ` · ${flagged} need a look` : ''} · each SKU = an item × pack size (e.g. 1L X 2 = 1L × 2)</p></div>
        <span className="text-sm text-ink-3">{open ? 'Hide ▲' : 'Show ▼'}</span>
      </button>
      {open && (
        <>
          <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
            <input className="input max-w-xs py-1.5" placeholder="Search SKU or item" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search SKU" />
            {msg.ok && <p className="text-xs text-emerald-700" role="status">{msg.ok}</p>}{msg.err && <p className="text-xs text-red-700" role="alert">{msg.err}</p>}
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="sticky top-0 bg-ivory text-left text-[11px] uppercase tracking-wider text-ink-3">
                <tr><th className="px-5 py-2 font-semibold">SKU</th><th className="py-2 font-semibold">Item × pack</th><th className="py-2 text-right font-semibold">Packs sold</th><th className="py-2 text-right font-semibold">Net units</th><th className="py-2 text-right font-semibold">Purchase</th><th className="py-2 text-right font-semibold">Settlement</th><th className="py-2 text-right font-semibold">Profit</th><th className="px-5 py-2 font-semibold">Note</th></tr>
              </thead>
              <tbody className="tabular-nums">
                {rows.map((s) => (
                  <tr key={s.sku} className="border-t border-ink/5">
                    <td className="px-5 py-1.5 font-medium">{s.sku}</td>
                    <td>
                      {edit?.sku === s.sku ? (
                        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                          <input aria-label="Item" className="w-36 rounded-lg border border-ink/20 px-2 py-0.5 text-xs" value={edit.item} onChange={(e) => setEdit({ ...edit, item: e.target.value })} />
                          <span className="text-xs">×</span>
                          <input aria-label="Pack size" type="number" min="1" className="w-14 rounded-lg border border-ink/20 px-2 py-0.5 text-xs" value={edit.packQty} onChange={(e) => setEdit({ ...edit, packQty: e.target.value })} />
                          <button className="rounded-lg bg-ink px-2 py-0.5 text-xs text-ivory">Save</button>
                          <button type="button" className="text-xs text-ink-3" onClick={() => setEdit(null)}>✕</button>
                        </form>
                      ) : (
                        <button className="text-left text-xs hover:underline" onClick={() => setEdit({ sku: s.sku, item: s.item, packQty: String(s.packQty) })}>{s.item} × {s.packQty} {s.mapped ? '' : <span className="text-ink-3">(auto)</span>} ✎</button>
                      )}
                    </td>
                    <td className="text-right">{num(s.grossQty)}</td><td className="text-right">{num(s.netUnits)}</td>
                    <td className="text-right">{inr(s.purchase)}</td><td className="text-right">{inr(s.sale)}</td>
                    <td className={`text-right ${s.profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{inr(s.profit)}</td>
                    <td className="px-5 text-xs text-sun-3">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** Ops: upload the month's Flipkart Orders report + Settlement reports → read in the background → review → publish. */
export function OpsOrdersPl({ orgId, period }: { orgId: string; period: string }) {
  const [orders, setOrders] = useState<File | null>(null);
  const [settles, setSettles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<{ ok?: string; err?: string }>({});
  const [key, setKey] = useState(0);
  async function start() {
    if (!orders || !settles.length) return setM({ err: 'Add the Orders report and at least one Settlement report' });
    setBusy(true); setM({});
    try {
      const ids: string[] = [];
      ids.push((await uploadFile(orders, { organizationId: orgId, kind: 'FLIPKART_ORDERS_REPORT', period, title: `Flipkart Orders report ${period}` })).id);
      for (const f of settles) ids.push((await uploadFile(f, { organizationId: orgId, kind: 'FLIPKART_SETTLEMENT_REPORT', period, title: `Flipkart Settlement report (${f.name})` })).id);
      await api(`/ops/reports/${orgId}/${period}/orders-pl`, { method: 'POST', body: { documentIds: ids } });
      setM({ ok: 'Uploaded. Reading the files…' }); setOrders(null); setSettles([]); setKey((k) => k + 1);
    } catch (e) { setM({ err: (e as Error).message }); }
    setBusy(false);
  }
  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-5" aria-label="Flipkart order profit import">
        <div><h2 className="font-semibold">Flipkart order-wise profit</h2><p className="text-xs text-ink-3">Seller Hub → Reports Centre: the month&rsquo;s <b>Orders report</b> + <b>Settlement reports</b> (1st–last day of the month, and 1st–20th of the next month).</p></div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="text-sm"><span className="label">Orders report (.xlsx)</span><input type="file" accept=".xlsx" data-testid="opl-orders" onChange={(e) => setOrders(e.target.files?.[0] ?? null)} /></label>
          <label className="text-sm"><span className="label">Settlement reports (.xlsx, 1–3 files)</span><input type="file" accept=".xlsx" multiple data-testid="opl-settlements" onChange={(e) => setSettles(Array.from(e.target.files ?? []))} /></label>
          <button className="btn-primary" disabled={busy} onClick={start}>{busy ? 'Uploading…' : 'Build report'}</button>
        </div>
        {m.ok && <p className="text-sm text-emerald-700" role="status">{m.ok}</p>}{m.err && <p className="text-sm text-red-700" role="alert">{m.err}</p>}
      </section>
      <OrdersPlDashboard paths={opsPaths(orgId, period)} period={period} reloadKey={key} staffActions={(v, reload) => (
        v.status === 'DONE' ? <PublishBar orgId={orgId} period={period} published={v.published} onDone={reload} /> : null
      )} />
    </div>
  );
}

function PublishBar({ orgId, period, published, onDone }: { orgId: string; period: string; published: boolean; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  async function publish() { try { await api(`/ops/reports/${orgId}/${period}/orders-pl/publish`, { method: 'POST' }); onDone(); } catch (e) { setErr((e as Error).message); } }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-ink/10 bg-ivory p-4 text-sm">
      <span>{published ? 'Published: the client sees this report.' : 'Draft: check the numbers, then publish to the client.'}</span>
      <button className="btn-primary py-1.5 text-xs" disabled={published} onClick={publish}>{published ? 'Published ✓' : 'Publish to client'}</button>
      {err && <span className="text-red-700">{err}</span>}
    </div>
  );
}
