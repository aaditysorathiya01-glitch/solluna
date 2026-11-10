'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { uploadFile } from './Chat';
import { Conf, rs } from './ReportView';

const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const toPaise = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s === '' ? null : Math.round(Number(s) * 100); };
const toInt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s === '' ? null : Math.round(Number(s)); };
const fromPaise = (p: number | null | undefined) => (p === null || p === undefined ? '' : String(p / 100));
const monthName = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function Msg({ ok, err }: { ok?: string | null; err?: string | null }) {
  if (!ok && !err) return null;
  return <p role={err ? 'alert' : 'status'} className={`text-sm ${err ? 'text-red-800' : 'text-emerald-800'}`}>{err ?? ok}</p>;
}

// ───────────────────────── Client ─────────────────────────

interface Cycle { period: string; label: string; status: 'MONTH_RUNNING' | 'WAITING_MARKETPLACE' | 'PREPARING' | 'READY'; marketplaceReportsOn: string; readyBy: string; reports: { id: string; kind: string }[] }
const CYCLE_LABEL: Record<Cycle['status'], string> = { MONTH_RUNNING: 'Month in progress', WAITING_MARKETPLACE: 'Waiting for marketplace reports', PREPARING: 'Being prepared', READY: 'Ready' };
const CYCLE_CHIP: Record<Cycle['status'], string> = { MONTH_RUNNING: 'bg-ivory text-ink-2', WAITING_MARKETPLACE: 'bg-sky-50 text-sky-800', PREPARING: 'bg-amber-50 text-amber-800', READY: 'bg-emerald-50 text-emerald-800' };
const CYCLE_TEXT: Record<Cycle['status'], (c: Cycle) => string> = {
  MONTH_RUNNING: (c) => `Amazon and Flipkart publish this month's reports on ${c.marketplaceReportsOn}. Your report: by ${c.readyBy}.`,
  WAITING_MARKETPLACE: (c) => `Amazon and Flipkart publish the reports on ${c.marketplaceReportsOn}. Your report: by ${c.readyBy}.`,
  PREPARING: (c) => `Marketplace reports are out. Your manager is preparing your report — ready by ${c.readyBy}.`,
  READY: () => 'Your report is ready.',
};

export function ClientReporting() {
  const [reports, setReports] = useState<any[]>([]);
  const [period, setPeriod] = useState(lastMonth());
  const [cycle, setCycle] = useState<Cycle[]>([]);
  useEffect(() => { api<any[]>('/reports').then(setReports).catch(() => {}); api<Cycle[]>('/reports/schedule').then(setCycle).catch(() => {}); }, []);
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="font-display text-3xl">Reports</h1>
        <p className="text-sm text-ink-3">Every month: the month closes → Amazon and Flipkart publish their reports on the 5th → your manager prepares your report from them and shares it here.</p>
        {cycle.length > 0 && (
          <div className="card divide-y divide-ink/5" aria-label="Monthly report schedule">
            {cycle.map((c) => (
              <div key={c.period} className="flex flex-wrap items-center justify-between gap-2 p-4" data-testid={`cycle-${c.period}`}>
                <div><p className="font-medium">{c.label}</p><p className="text-xs text-ink-3">{CYCLE_TEXT[c.status](c)}</p></div>
                {c.status === 'READY'
                  ? <div className="flex gap-2">{c.reports.map((r) => <Link key={r.id} href={`/reports/${r.id}`} className="btn-ghost py-1 text-xs">{r.kind === 'PL' ? 'P&L report' : 'Performance report'}</Link>)}</div>
                  : <span className={`chip ${CYCLE_CHIP[c.status]}`}>{CYCLE_LABEL[c.status]}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="card divide-y divide-ink/5">
          {reports.map((r) => (
            <Link key={r.id} href={`/reports/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-ivory" data-testid="report-row">
              <span className="font-medium">{monthName(r.periodMonth)} · {r.kind === 'PL' ? 'P&L report' : 'Business performance'} <span className="text-xs text-ink-3">v{r.version}</span></span>
              <Conf c={r.confidence} />
            </Link>
          ))}
          {!reports.length && <p className="p-4 text-sm text-ink-3">Your monthly reports will appear here once your manager publishes them.</p>}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <label className="label mb-0" htmlFor="period">Month</label>
        <input id="period" type="month" className="input w-auto" value={period} max={new Date().toISOString().slice(0, 7)} onChange={(e) => setPeriod(e.target.value)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ProductCosts />
        <Expenses period={period} />
      </div>
      <CaPack period={period} />
    </div>
  );
}

function ProductCosts() {
  const [costs, setCosts] = useState<any[]>([]);
  const [m, setM] = useState<{ ok?: string; err?: string }>({});
  const load = useCallback(() => api<any[]>('/costs').then(setCosts).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api('/costs', { method: 'POST', body: { sku: String(f.get('sku')).trim(), costPaise: toPaise(f.get('cost')), includesGst: f.get('gst') === 'on', effectiveFrom: String(f.get('from')) } });
      (e.target as HTMLFormElement).reset(); setM({ ok: 'Cost saved.' }); load();
    } catch (err) { setM({ err: (err as Error).message }); }
  }
  return (
    <section className="card space-y-3 p-5">
      <div><h2 className="font-semibold">Product costs</h2><p className="text-xs text-ink-3">Landed cost per unit: purchase + inbound freight + packaging + prep. Without these we will not show product profit.</p></div>
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end" aria-label="Add product cost">
        <div><label className="label" htmlFor="c-sku">SKU</label><input id="c-sku" name="sku" className="input" required /></div>
        <div><label className="label" htmlFor="c-cost">Cost / unit (₹)</label><input id="c-cost" name="cost" type="number" step="0.01" min="0.01" className="input" required /></div>
        <div><label className="label" htmlFor="c-from">Effective from</label><input id="c-from" name="from" type="date" className="input" required /></div>
        <button className="btn-primary">Save</button>
        <label className="flex items-center gap-2 text-xs text-ink-3 sm:col-span-4"><input type="checkbox" name="gst" /> Cost includes GST</label>
      </form>
      <Msg ok={m.ok} err={m.err} />
      <table className="w-full text-sm"><tbody>
        {costs.map((c) => <tr key={c.id} className="border-t border-ink/5"><td className="py-1.5">{c.sku}</td><td className="text-right">{rs(c.costPaise)}{c.includesGst ? ' incl. GST' : ''}</td><td className="text-right text-xs text-ink-3">from {new Date(c.effectiveFrom).toLocaleDateString('en-IN')}{!c.clientConfirmed && ' · entered by SOLLUNA, please confirm'}</td></tr>)}
        {!costs.length && <tr><td className="py-1.5 text-ink-3">No costs yet.</td></tr>}
      </tbody></table>
    </section>
  );
}

function Expenses({ period }: { period: string }) {
  const [data, setData] = useState<{ items: any[]; confirmed: boolean }>({ items: [], confirmed: false });
  const [m, setM] = useState<{ ok?: string; err?: string }>({});
  const latest = useRef('');
  const load = useCallback(() => {
    latest.current = period;
    return api<any>(`/expenses?period=${period}`).then((d) => { if (latest.current === period) setData(d); }).catch((e) => setM({ err: e.message }));
  }, [period]);
  useEffect(() => { setM({}); load(); }, [load]);
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api('/expenses', { method: 'POST', body: { period, category: f.get('category'), description: f.get('description'), amountPaise: toPaise(f.get('amount')) } });
      (e.target as HTMLFormElement).reset(); setM({}); load();
    } catch (err) { setM({ err: (err as Error).message }); }
  }
  const total = data.items.reduce((a, x) => a + x.amountPaise, 0);
  return (
    <section className="card space-y-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <div><h2 className="font-semibold">Operating expenses · {monthName(`${period}-01`)}</h2><p className="text-xs text-ink-3">Rent, staff, software, professional fees… Confirm when the list is complete.</p></div>
        {data.confirmed && <span className="chip bg-emerald-50 text-emerald-800">Confirmed</span>}
      </div>
      {!data.confirmed && (
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_1.5fr_1fr_auto] sm:items-end" aria-label="Add expense">
          <div><label className="label" htmlFor="x-cat">Category</label><select id="x-cat" name="category" className="input">{['RENT', 'STAFF', 'SOFTWARE', 'PROFESSIONAL', 'TRANSPORT', 'OTHER'].map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label" htmlFor="x-desc">Description</label><input id="x-desc" name="description" className="input" required /></div>
          <div><label className="label" htmlFor="x-amt">Amount (₹)</label><input id="x-amt" name="amount" type="number" step="0.01" min="0.01" className="input" required /></div>
          <button className="btn-primary">Add</button>
        </form>
      )}
      <Msg ok={m.ok} err={m.err} />
      <table className="w-full text-sm"><tbody>
        {data.items.map((x) => (
          <tr key={x.id} className="border-t border-ink/5"><td className="py-1.5">{x.description} <span className="text-xs text-ink-3">{x.category.toLowerCase()}</span></td><td className="text-right">{rs(x.amountPaise)}</td>
            <td className="w-12 text-right">{!data.confirmed && <button className="text-xs underline" onClick={async () => { await api(`/expenses/${x.id}`, { method: 'DELETE' }); load(); }}>Remove</button>}</td></tr>
        ))}
        <tr className="border-t border-ink/10 font-semibold"><td className="py-1.5">Total</td><td className="text-right">{rs(total)}</td><td /></tr>
      </tbody></table>
      <button className={data.confirmed ? 'btn-ghost text-xs' : 'btn-gold text-xs'} onClick={async () => {
        await api('/expenses/confirm', { method: 'POST', body: { period, confirmed: !data.confirmed } });
        setM({ ok: data.confirmed ? 'Reopened for editing.' : 'Expenses confirmed as complete for this month.' }); load();
      }}>{data.confirmed ? 'Reopen expenses' : 'Confirm this list is complete'}</button>
    </section>
  );
}

const CA_KINDS: [string, string][] = [
  ['FLIPKART_GSTR_REPORT', 'Flipkart GSTR return report'], ['FLIPKART_SALES_REPORT', 'Flipkart sales report'], ['FLIPKART_TDS', 'Flipkart TDS report'],
  ['AMAZON_MTR_B2B', 'Amazon MTR (B2B)'], ['AMAZON_MTR_B2C', 'Amazon MTR (B2C)'],
  ['AMAZON_SETTLEMENT', 'Amazon settlement report'], ['AMAZON_FEE_INVOICE', 'Amazon fee / tax invoice'], ['AMAZON_TCS', 'Amazon TCS statement'],
  ['FLIPKART_SETTLEMENT', 'Flipkart settlement report'], ['FLIPKART_FEE_INVOICE', 'Flipkart fee invoice / note'], ['FLIPKART_TCS', 'Flipkart TCS statement'],
  ['PURCHASE_INVOICE', 'Purchase invoice'], ['EXPENSE_INVOICE', 'Expense invoice'], ['BANK_STATEMENT', 'Bank statement'],
];

export function CaPack({ period, orgId }: { period: string; orgId?: string }) {
  const [pack, setPack] = useState<any>(null);
  const [m, setM] = useState<{ ok?: string; err?: string }>({});
  const url = orgId ? `/ops/reports/${orgId}/${period}/ca-pack` : `/ca-pack?period=${period}`;
  const latest = useRef('');
  const load = useCallback(() => {
    latest.current = url;
    return api<any>(url).then((p) => { if (latest.current === url) setPack(p); }).catch((e) => { if (latest.current === url) { setPack(null); setM({ err: e.message }); } });
  }, [url]);
  useEffect(() => { setM({}); load(); }, [load]);
  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get('file') as File;
    if (!file?.size) return setM({ err: 'Choose a file' });
    try {
      await uploadFile(file, { kind: String(f.get('kind')), period, ...(orgId ? { organizationId: orgId } : {}) });
      (e.target as HTMLFormElement).reset(); setM({ ok: 'Added to the CA pack.' }); load();
    } catch (err) { setM({ err: (err as Error).message }); }
  }
  return (
    <section className="card space-y-4 p-5" aria-label="CA documentation pack">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="font-semibold">CA documentation pack · {pack?.period ?? period}</h2><p className="text-xs text-ink-3">Everything your Chartered Accountant needs for the month, in one index.</p></div>
        {pack && <span className={`chip ${pack.complete ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{pack.complete ? 'Complete' : `${pack.missing.length} missing`}</span>}
      </div>
      <form onSubmit={upload} className="grid gap-2 sm:grid-cols-[1.2fr_1fr_auto] sm:items-end" aria-label="Add to CA pack">
        <div><label className="label" htmlFor="ca-kind">Document</label><select id="ca-kind" name="kind" className="input">{CA_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label className="label" htmlFor="ca-file">File</label><input id="ca-file" name="file" type="file" className="input" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx,.csv,.txt" /></div>
        <button className="btn-primary">Add</button>
      </form>
      <Msg ok={m.ok} err={m.err} />
      {pack && (
        <>
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wider text-ink-3"><th className="py-2">#</th><th>Document</th><th>Category</th><th>Status</th></tr></thead>
            <tbody>
              {pack.index.map((i: any) => (
                <tr key={i.sr} className="border-t border-ink/5"><td className="py-1.5">{i.sr}</td>
                  <td>{i.documentId ? <a className="underline" href={`/api/documents/${i.documentId}/download`}>{i.document}</a> : i.plReportId || i.source === 'SOLLUNA' ? <Link className="underline" href={`/reports/${i.reference}`}>{i.document}</Link> : i.document}<p className="text-xs text-ink-3">{i.source}</p></td>
                  <td className="text-ink-3">{i.category}</td><td>{i.status}</td></tr>
              ))}
            </tbody>
          </table>
          {pack.missing.length > 0 && (
            <div><p className="label">Still needed</p><ul className="list-inside list-disc text-sm text-ink-2">{pack.missing.map((x: any) => <li key={x.required}>{x.required} <span className="text-xs text-ink-3">· from {x.requestedFrom}</span></li>)}</ul></div>
          )}
          {pack.caQuestions.length > 0 && <div><p className="label">For your CA to review</p><ul className="list-inside list-disc text-sm">{pack.caQuestions.map((q: string) => <li key={q}>{q}</li>)}</ul></div>}
          <p className="text-xs text-ink-3">{pack.disclaimer}</p>
        </>
      )}
    </section>
  );
}

// ───────────────────────── Staff workbench ─────────────────────────

const MONTH_FIELDS: [string, string, 'paise' | 'int'][] = [
  ['grossSalesPaise', 'Gross sales (₹)', 'paise'], ['discountsPaise', 'Discounts (₹)', 'paise'], ['returnsRefundsPaise', 'Returns / refunds (₹)', 'paise'], ['reimbursementsPaise', 'Reimbursements (₹)', 'paise'],
  ['orders', 'Orders', 'int'], ['unitsSold', 'Units sold', 'int'], ['unitsReturned', 'Units returned', 'int'], ['cancelledOrders', 'Cancelled orders', 'int'], ['sessions', 'Sessions', 'int'],
  ['commissionPaise', 'Commission (₹)', 'paise'], ['fixedFeesPaise', 'Fixed / closing fees (₹)', 'paise'], ['fulfilmentPaise', 'Fulfilment (₹)', 'paise'], ['shippingPaise', 'Shipping (₹)', 'paise'], ['storagePaise', 'Storage (₹)', 'paise'], ['otherFeesPaise', 'Other fees (₹)', 'paise'],
  ['adSpendPaise', 'Ad spend (₹)', 'paise'], ['adSalesPaise', 'Ad-attributed sales (₹)', 'paise'], ['impressions', 'Impressions', 'int'], ['clicks', 'Clicks', 'int'],
  ['settlementPaise', 'Settlement amount (₹)', 'paise'], ['bankCreditPaise', 'Verified bank credit (₹)', 'paise'], ['reservesPaise', 'Reserves / holds (₹)', 'paise'],
];

export function OpsReporting() {
  const [clients, setClients] = useState<any[]>([]);
  const [orgId, setOrgId] = useState('');
  const [period, setPeriod] = useState(lastMonth());
  const [wb, setWb] = useState<any>(null);
  const [m, setM] = useState<{ ok?: string; err?: string }>({});
  useEffect(() => { api<any[]>('/ops/reports/clients').then((c) => { setClients(c); if (c[0]) setOrgId(c[0].id); }).catch(() => {}); }, []);
  const latest = useRef('');
  const load = useCallback(() => {
    if (!orgId) return;
    const key = `${orgId}/${period}`;
    latest.current = key; // ignore responses for a client/month the user has already moved away from
    api<any>(`/ops/reports/${key}`).then((d) => { if (latest.current === key) setWb(d); }).catch((e) => { if (latest.current === key) setM({ err: e.message }); });
  }, [orgId, period]);
  useEffect(() => { setM({}); load(); }, [load]);

  async function saveMonth(mp: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { salesBasis: f.get('salesBasis'), adSpendInFees: f.get('adSpendInFees') === 'on', sourceNote: String(f.get('sourceNote') ?? '') || undefined };
    for (const [k, , t] of MONTH_FIELDS) body[k] = t === 'paise' ? toPaise(f.get(k)) : toInt(f.get(k));
    try {
      await api(`/ops/reports/${orgId}/${period}/marketplaces/${mp}`, { method: 'PUT', body });
      const csv = String(f.get('skuCsv') ?? '').trim();
      if (csv) {
        const lines = csv.split(/\r?\n/).filter((l) => l.trim() && !/^sku\s*,/i.test(l)).map((l) => {
          const [sku, units, net, fees, ads] = l.split(',').map((x) => x.trim());
          return { sku, units: Number(units), netSalesPaise: Math.round(Number(net) * 100), feesPaise: fees ? Math.round(Number(fees) * 100) : null, adSpendPaise: ads ? Math.round(Number(ads) * 100) : null };
        });
        await api(`/ops/reports/${orgId}/${period}/marketplaces/${mp}/sku-lines`, { method: 'PUT', body: { lines } });
      }
      setM({ ok: `${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'} figures saved.` }); load();
    } catch (err) { setM({ err: (err as Error).message }); }
  }

  async function generate(kind: 'PL' | 'PERFORMANCE') {
    try { await api(`/ops/reports/${orgId}/${period}/generate`, { method: 'POST', body: { kind } }); setM({ ok: 'Draft generated. Review it, then publish.' }); load(); }
    catch (err) { setM({ err: (err as Error).message }); }
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto font-display text-2xl">Monthly reporting</h1>
        <div><label className="label" htmlFor="rep-client">Client</label><select id="rep-client" className="input w-auto" value={orgId} onChange={(e) => setOrgId(e.target.value)}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.plan ? ` · ${c.plan}` : ''}</option>)}</select></div>
        <div><label className="label" htmlFor="rep-period">Month</label><input id="rep-period" type="month" className="input w-auto" value={period} max={new Date().toISOString().slice(0, 7)} onChange={(e) => setPeriod(e.target.value)} /></div>
      </div>
      <Msg ok={m.ok} err={m.err} />
      {!clients.length && <p className="card p-6 text-sm text-ink-3">No clients available for reporting.</p>}
      {wb && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-6">
            {(['AMAZON', 'FLIPKART'] as const).map((mp) => {
              const cur = wb.inputs.months.find((x: any) => x.marketplace === mp) ?? {};
              const skus = wb.inputs.skuLines.filter((l: any) => l.marketplace === mp);
              return (
                <form key={mp + period + orgId} onSubmit={(e) => saveMonth(mp, e)} className="card space-y-3 p-5" aria-label={`${mp} figures`}>
                  <div className="flex items-center justify-between"><h2 className="font-semibold">{mp === 'AMAZON' ? 'Amazon' : 'Flipkart'} · {wb.periodLabel}</h2>{cur.id && <span className="chip bg-emerald-50 text-emerald-800">Saved</span>}</div>
                  <p className="text-xs text-ink-3">Amounts GST-exclusive, from marketplace reports. Leave blank if not available. Blank is reported as missing, never as zero.</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div><label className="label" htmlFor={`${mp}-basis`}>Sales basis</label><select id={`${mp}-basis`} name="salesBasis" className="input" defaultValue={cur.salesBasis ?? 'SHIPPED'}><option>SHIPPED</option><option>ORDERED</option></select></div>
                    {MONTH_FIELDS.map(([k, l, t]) => (
                      <div key={k}><label className="label" htmlFor={`${mp}-${k}`}>{l}</label><input id={`${mp}-${k}`} name={k} type="number" step={t === 'paise' ? '0.01' : '1'} min="0" className="input" defaultValue={t === 'paise' ? fromPaise(cur[k]) : cur[k] ?? ''} /></div>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="adSpendInFees" defaultChecked={cur.adSpendInFees} /> Ad spend is already deducted inside marketplace fees</label>
                  <div><label className="label" htmlFor={`${mp}-src`}>Source reports used</label><input id={`${mp}-src`} name="sourceNote" className="input" defaultValue={cur.sourceNote ?? ''} /></div>
                  <div><label className="label" htmlFor={`${mp}-sku`}>SKU lines (CSV: sku, units, net sales ₹, fees ₹, ad spend ₹), replaces existing</label>
                    <textarea id={`${mp}-sku`} name="skuCsv" className="input min-h-20 font-mono text-xs" placeholder="SB-750,60,60000,12000,2000" defaultValue={skus.map((l: any) => [l.sku, l.units, l.netSalesPaise / 100, l.feesPaise === null ? '' : l.feesPaise / 100, l.adSpendPaise === null ? '' : l.adSpendPaise / 100].join(',')).join('\n')} /></div>
                  <button className="btn-primary">Save {mp === 'AMAZON' ? 'Amazon' : 'Flipkart'} figures</button>
                </form>
              );
            })}
            <CaPack period={period} orgId={orgId} />
          </div>
          <aside className="space-y-4">
            <section className="card space-y-3 p-5">
              <h2 className="font-semibold">Live preview</h2>
              {!wb.preview ? <p className="text-sm text-ink-3">Enter at least one marketplace's figures.</p> : (
                <dl className="space-y-1.5 text-sm">
                  {[['Net revenue', wb.preview.pl.consolidated.netRevenue], ['Product cost', wb.preview.pl.consolidated.cogs], ['Contribution', wb.preview.pl.consolidated.contribution], [wb.preview.pl.operatingResult.label, wb.preview.pl.operatingResult]].map(([k, l]: any) => (
                    <div key={k} className="flex items-center justify-between gap-2"><dt className="text-ink-3">{k}</dt><dd className="flex items-center gap-2">{rs(l.paise)} <Conf c={l.conf} /></dd></div>
                  ))}
                  <div className="flex justify-between"><dt className="text-ink-3">Overall</dt><dd><Conf c={wb.preview.pl.confidence} /></dd></div>
                  {wb.preview.pl.assumptions.length > 0 && <p className="pt-2 text-xs text-ink-3">{wb.preview.pl.assumptions.length} data gap(s): {wb.preview.pl.assumptions.map((a: any) => a.item).join('; ')}</p>}
                </dl>
              )}
              <p className="text-xs text-ink-3">Client inputs: {wb.inputs.costs.length} SKU cost(s), {wb.inputs.expenses.length} expense(s){wb.inputs.expensesConfirmed ? ', confirmed' : ', not confirmed'}.</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary text-xs" disabled={!wb.preview} onClick={() => generate('PERFORMANCE')}>Generate performance draft</button>
                <button className="btn-primary text-xs" disabled={!wb.preview} onClick={() => generate('PL')}>Generate P&amp;L draft</button>
              </div>
            </section>
            <section className="card p-5">
              <h2 className="mb-2 font-semibold">Versions</h2>
              <ul className="space-y-2 text-sm">
                {wb.reports.map((r: any) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/5 pb-2" data-testid="report-version">
                    <Link className="underline" href={`/reports/${r.id}`}>{r.kind === 'PL' ? 'P&L' : 'Performance'} v{r.version}</Link>
                    <span className="flex items-center gap-2"><Conf c={r.confidence} /><span className="text-xs text-ink-3">{r.status.toLowerCase()}</span>
                      {r.status === 'DRAFT' && <button className="btn-gold px-3 py-1 text-xs" onClick={async () => { try { await api(`/ops/reports/drafts/${r.id}/publish`, { method: 'POST' }); setM({ ok: 'Published. The client has been notified.' }); load(); } catch (err) { setM({ err: (err as Error).message }); } }}>Publish</button>}</span>
                  </li>
                ))}
                {!wb.reports.length && <li className="text-ink-3">No reports generated for this month.</li>}
              </ul>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}
