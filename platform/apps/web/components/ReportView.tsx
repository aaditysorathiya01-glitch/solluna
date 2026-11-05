'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

const CONF_STYLE: Record<string, string> = {
  VERIFIED: 'bg-emerald-50 text-emerald-800', ESTIMATED: 'bg-amber-50 text-amber-800', UNAVAILABLE: 'bg-ink/5 text-ink-3',
};
const RECON_LABEL: Record<string, string> = {
  RECONCILED: 'Reconciled', PARTIALLY_RECONCILED: 'Partially reconciled', NOT_RECONCILED: 'Not reconciled', PENDING_SOURCE_DATA: 'Pending source data',
};
export const Conf = ({ c }: { c: string }) => <span className={`chip ${CONF_STYLE[c] ?? 'bg-ink/5'}`}>{c.charAt(0) + c.slice(1).toLowerCase()}</span>;

export const rs = (p: number | null | undefined) =>
  p === null || p === undefined ? '—' : `${p < 0 ? '−' : ''}₹${(Math.abs(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const metric = (v: any, suffix = '%') =>
  v === null || v === undefined ? 'Not available' : v === 'NOT_MEANINGFUL' ? 'Not meaningful' : v === 'NO_BASELINE' ? 'No previous-month baseline' : v === 'NEW' ? 'New' : `${v}${suffix}`;
const MP: Record<string, string> = { AMAZON: 'Amazon', FLIPKART: 'Flipkart', CONSOLIDATED: 'Consolidated' };
const ORDER = ['grossSales', 'discounts', 'returns', 'reimbursements', 'netRevenue', 'cogs', 'fees', 'marketing', 'contribution', 'beforeProductCost'];

function PLTable({ title, lines, extra }: { title: string; lines: Record<string, any>; extra?: any[] }) {
  // The pre-product-cost line only helps when product cost (and so real contribution) is missing.
  const rows = [...ORDER.filter((k) => lines[k] && !(k === 'beforeProductCost' && lines.contribution?.paise !== null)).map((k) => lines[k]), ...(extra ?? [])];
  return (
    <section className="card overflow-x-auto p-5 print:break-inside-avoid">
      <h3 className="mb-2 font-semibold">{title}</h3>
      <table className="w-full min-w-[520px] text-sm">
        <tbody>
          {rows.map((l) => (
            <tr key={l.key} className={`border-t border-ink/5 ${['netRevenue', 'contribution', 'operatingResult'].includes(l.key) ? 'font-semibold' : ''}`}>
              <td className="py-2 pr-3">{l.label}{l.note && <p className="text-xs font-normal text-ink-3">{l.note}</p>}</td>
              <td className="whitespace-nowrap py-2 text-right tabular-nums">{rs(l.paise)}</td>
              <td className="py-2 pl-3 text-right"><Conf c={l.conf} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ReportView({ report }: { report: any }) {
  const d = report.data;
  const org = report.organization?.brandName ?? report.organization?.legalName;
  return (
    <article className="space-y-5" aria-label="Monthly report">
      <header className="card flex flex-wrap items-start justify-between gap-4 p-6">
        <div>
          <p className="label">{report.kind === 'PL' ? 'Monthly P&L report' : 'Monthly business performance report'}</p>
          <h1 className="font-display text-3xl">{report.periodLabel}</h1>
          <p className="text-sm text-ink-3">{org} · Version {report.version}{report.status !== 'PUBLISHED' ? ` · ${report.status}` : ''}</p>
        </div>
        <div className="text-right">
          <p className="label">Overall confidence</p>
          <Conf c={report.confidence} />
          {report.confidence !== 'VERIFIED' && <p className="mt-2 max-w-xs text-xs text-ink-3">Some figures are estimated or unavailable. See “Missing data” below for what is needed.</p>}
        </div>
      </header>

      {report.kind === 'PL' ? (
        <>
          <p className="text-xs text-ink-3">{d.gstBasis} Sales basis is stated per marketplace; ordered and shipped sales are never mixed.</p>
          <section className="card p-6">
            <h2 className="font-semibold">Executive summary</h2>
            <dl className="mt-3 grid gap-4 sm:grid-cols-4">
              {[['Net revenue', d.consolidated.netRevenue], ['Contribution', d.consolidated.contribution], [d.operatingResult.label, d.operatingResult]].map(([k, l]: any) => (
                <div key={k}><dt className="text-xs text-ink-3">{k}</dt><dd className="font-display text-2xl">{rs(l.paise)}</dd><Conf c={l.conf} /></div>
              ))}
              <div><dt className="text-xs text-ink-3">Settlement reconciliation</dt><dd className="mt-1 font-semibold">{RECON_LABEL[d.reconciliation.status]}</dd></div>
            </dl>
            <dl className="mt-5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              {[['Product cost ratio', d.metrics.productCostRatioPct], ['Marketplace fee ratio', d.metrics.marketplaceFeeRatioPct], ['Advertising ratio', d.metrics.advertisingRatioPct], ['Contribution margin', d.metrics.contributionMarginPct], ['Operating expense ratio', d.metrics.operatingExpenseRatioPct]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between border-b border-ink/5 py-1"><dt className="text-ink-3">{k}</dt><dd>{metric(v)}</dd></div>
              ))}
            </dl>
          </section>
          {d.marketplaces.map((m: any) => <PLTable key={m.marketplace} title={`${MP[m.marketplace]} P&L (${m.salesBasis.toLowerCase()} basis)`} lines={m.lines} />)}
          {d.marketplaces.length > 1 && <PLTable title="Consolidated marketplace view" lines={d.consolidated} />}
          <PLTable title="Operating result" lines={{}} extra={[{ ...d.consolidated.contribution, key: 'contribution' }, d.opex.line, d.operatingResult]} />

          <section className="card overflow-x-auto p-5">
            <h3 className="mb-2 font-semibold">Product-wise profitability</h3>
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-ink-3"><th className="py-2">SKU</th><th>Units</th><th className="text-right">Net sales</th><th className="text-right">Product cost</th><th className="text-right">Fees</th><th className="text-right">Ads</th><th className="text-right">Contribution</th><th className="text-right">Margin</th></tr></thead>
              <tbody>
                {d.products.map((p: any) => (
                  <tr key={p.marketplace + p.sku} className="border-t border-ink/5">
                    <td className="py-2">{p.sku} <span className="text-xs text-ink-3">{MP[p.marketplace]}</span>{p.provisional && <span className="chip ml-1 bg-amber-50 text-amber-800">Provisional</span>}{p.note && <p className="text-xs text-ink-3">{p.note}</p>}</td>
                    <td>{p.units}</td><td className="text-right">{rs(p.netSalesPaise)}</td><td className="text-right">{rs(p.productCostPaise)}</td><td className="text-right">{rs(p.feesPaise)}</td><td className="text-right">{rs(p.adsPaise)}</td>
                    <td className={`text-right font-medium ${p.contributionPaise < 0 ? 'text-red-700' : ''}`}>{rs(p.contributionPaise)}</td><td className="text-right">{metric(p.contributionPct)}</td>
                  </tr>
                ))}
                {!d.products.length && <tr><td className="py-2 text-ink-3" colSpan={8}>No SKU-level data for this month.</td></tr>}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink-3">Shared fees and ads are not allocated arbitrarily; rows without SKU-level data are marked provisional.</p>
          </section>

          <section className="card overflow-x-auto p-5">
            <h3 className="mb-2 font-semibold">Settlement-to-bank reconciliation</h3>
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-ink-3"><th className="py-2">Marketplace</th><th className="text-right">Settlement</th><th className="text-right">Bank credit</th><th className="text-right">Reserves</th><th className="text-right">Unmatched</th><th className="text-right">Status</th></tr></thead>
              <tbody>
                {d.reconciliation.marketplaces.map((r: any) => (
                  <tr key={r.marketplace} className="border-t border-ink/5"><td className="py-2">{MP[r.marketplace]}{r.note && <p className="text-xs text-ink-3">{r.note}</p>}</td><td className="text-right">{rs(r.settlementPaise)}</td><td className="text-right">{rs(r.bankCreditPaise)}</td><td className="text-right">{rs(r.reservesPaise)}</td><td className="text-right">{rs(r.unmatchedPaise)}</td><td className="text-right">{RECON_LABEL[r.status]}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <section className="card overflow-x-auto p-5">
          <h3 className="mb-2 font-semibold">Marketplace performance</h3>
          <table className="w-full min-w-[640px] text-sm">
            <tbody>
              {[
                ['Gross sales', (k: any) => rs(k.grossSalesPaise)], ['Orders', (k: any) => k.orders ?? 'Not available'], ['Units sold', (k: any) => k.unitsSold ?? 'Not available'],
                ['Average order value', (k: any) => (typeof k.averageOrderValuePaise === 'number' ? rs(k.averageOrderValuePaise) : metric(k.averageOrderValuePaise, ''))],
                ['Average selling price', (k: any) => (typeof k.averageSellingPricePaise === 'number' ? rs(k.averageSellingPricePaise) : metric(k.averageSellingPricePaise, ''))],
                ['Conversion rate (orders ÷ sessions)', (k: any) => metric(k.conversionRatePct)], ['Return rate', (k: any) => metric(k.returnRatePct)],
                ['Cancellation rate', (k: any) => metric(k.cancellationRatePct)], ['Ad spend', (k: any) => rs(k.adSpendPaise)], ['ACOS', (k: any) => metric(k.acosPct)],
                ['ROAS', (k: any) => metric(k.roas, '×')], ['CTR', (k: any) => metric(k.ctrPct)], ['Sales vs previous month', (k: any) => metric(k.momGrossSalesPct)],
              ].map(([labelText, f]: any) => (
                <tr key={labelText} className="border-t border-ink/5"><td className="py-2 text-ink-3">{labelText}</td>{d.marketplaces.map((k: any) => <td key={k.marketplace} className="py-2 text-right">{f(k)}</td>)}</tr>
              ))}
            </tbody>
            <thead><tr><th />{d.marketplaces.map((k: any) => <th key={k.marketplace} className="py-2 text-right">{MP[k.marketplace]}</th>)}</tr></thead>
          </table>
          {d.topProducts.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 font-semibold">Top products by sales</h3>
              <ul className="space-y-1 text-sm">{d.topProducts.map((p: any) => <li key={p.marketplace + p.sku} className="flex justify-between border-b border-ink/5 py-1"><span>{p.sku} · {MP[p.marketplace]} · {p.units} units</span><span>{rs(p.netSalesPaise)}</span></li>)}</ul>
            </>
          )}
        </section>
      )}

      {(report.kind === 'PL' ? d.actionPlan : d.recommendations).length > 0 && (
        <section className="card p-5">
          <h3 className="mb-3 font-semibold">{report.kind === 'PL' ? 'Findings & action plan' : 'Recommendations'}</h3>
          <ul className="space-y-3 text-sm">
            {(report.kind === 'PL' ? d.actionPlan : d.recommendations).map((a: any, i: number) => (
              <li key={i} className="rounded-xl bg-ivory p-3">
                <p className="font-semibold"><span className={`chip mr-2 ${a.priority === 'P1' ? 'bg-red-50 text-red-800' : a.priority === 'P2' ? 'bg-amber-50 text-amber-800' : 'bg-ink/5'}`}>{a.priority}</span>{a.finding}</p>
                <p className="mt-1 text-ink-3">Evidence: {a.evidence}</p>
                <p className="mt-1">Action: {a.action} · <span className="text-ink-3">Owner: {a.responsible}{a.approvalRequired ? ' · needs your approval before any change' : ''}</span></p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(report.kind === 'PL' ? d.assumptions : d.dataGaps).length > 0 && (
        <section className="card overflow-x-auto p-5">
          <h3 className="mb-2 font-semibold">Missing data &amp; assumptions</h3>
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wider text-ink-3"><th className="py-2">Item</th><th>Missing / assumed</th><th>Impact</th><th>Needed</th><th>From</th></tr></thead>
            <tbody>
              {(report.kind === 'PL' ? d.assumptions : d.dataGaps).map((a: any, i: number) => (
                <tr key={i} className="border-t border-ink/5 align-top"><td className="py-2 pr-2">{a.item}</td><td className="pr-2">{a.missing}</td><td className="pr-2">{a.impact}</td><td className="pr-2">{a.confirm}</td><td>{a.owner}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="text-xs text-ink-3">Figures are prepared from marketplace reports and the costs you provided. Rankings, sales and tax outcomes are not guaranteed. Not a tax filing or audit.</p>
    </article>
  );
}
