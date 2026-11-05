/**
 * Monthly P&L + performance engine. Pure functions — no I/O — so every rule is unit-testable.
 * Implements .claude/skills/monthly-pl-report (§5–§14) and monthly-business-performance-report (§6).
 *
 * Non-negotiables enforced here:
 *  - NULL input = "not provided", never zero.
 *  - Missing product cost  → no product profit (contribution UNAVAILABLE).
 *  - Missing ad spend      → contribution shown but ESTIMATED, "excludes advertising".
 *  - Expenses unconfirmed  → operating result is partial (ESTIMATED).
 *  - No industry averages, no arbitrary allocation, divide-by-zero → "Not meaningful" / "No baseline".
 *  - A settlement is never "received" without a verified bank credit.
 */

export type Conf = 'VERIFIED' | 'ESTIMATED' | 'UNAVAILABLE';
export type Mp = 'AMAZON' | 'FLIPKART';

export interface MarketplaceInput {
  marketplace: Mp; salesBasis: string;
  grossSalesPaise: number | null; discountsPaise: number | null; returnsRefundsPaise: number | null; reimbursementsPaise: number | null;
  orders: number | null; unitsSold: number | null; unitsReturned: number | null; cancelledOrders: number | null; sessions: number | null;
  commissionPaise: number | null; fixedFeesPaise: number | null; fulfilmentPaise: number | null; shippingPaise: number | null; storagePaise: number | null; otherFeesPaise: number | null;
  adSpendPaise: number | null; adSalesPaise: number | null; impressions: number | null; clicks: number | null; adSpendInFees: boolean;
  settlementPaise: number | null; bankCreditPaise: number | null; reservesPaise: number | null;
}
export interface SkuLine { marketplace: Mp; sku: string; units: number; netSalesPaise: number; feesPaise: number | null; adSpendPaise: number | null }
export interface CostInfo { costPaise: number; clientConfirmed: boolean; includesGst: boolean }
export interface ReportInputs {
  periodLabel: string;
  marketplaces: MarketplaceInput[];
  previous: MarketplaceInput[];
  skuLines: SkuLine[];
  costFor: (sku: string) => CostInfo | null;
  expenses: { category: string; description: string; amountPaise: number }[];
  expensesConfirmed: boolean;
}

export interface Line { key: string; label: string; paise: number | null; conf: Conf; note?: string }
type Metric = number | 'NOT_MEANINGFUL' | null;
type Change = number | 'NO_BASELINE' | 'NEW' | null;

const FEE_FIELDS = [
  ['commissionPaise', 'Referral / commission fees'], ['fixedFeesPaise', 'Closing / fixed fees'], ['fulfilmentPaise', 'Fulfilment fees'],
  ['shippingPaise', 'Shipping & logistics'], ['storagePaise', 'Storage & removal'], ['otherFeesPaise', 'Other marketplace fees'],
] as const;

const worst = (...c: Conf[]): Conf => (c.includes('UNAVAILABLE') ? 'UNAVAILABLE' : c.includes('ESTIMATED') ? 'ESTIMATED' : 'VERIFIED');
const pct = (n: number | null, d: number | null): Metric => (n === null || d === null ? null : d > 0 ? Math.round((n / d) * 10000) / 100 : 'NOT_MEANINGFUL');
const per = (n: number | null, d: number | null): Metric => (n === null || d === null ? null : d > 0 ? Math.round(n / d) : 'NOT_MEANINGFUL');
const ratio = (n: number | null, d: number | null): Metric => (n === null || d === null ? null : d > 0 ? Math.round((n / d) * 100) / 100 : 'NOT_MEANINGFUL');
export function change(cur: number | null, prev: number | null | undefined): Change {
  if (cur === null) return null;
  if (prev === null || prev === undefined) return 'NO_BASELINE';
  if (prev === 0) return cur === 0 ? 0 : 'NEW';
  return Math.round(((cur - prev) / Math.abs(prev)) * 10000) / 100;
}
const inr = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const MP_NAME: Record<Mp, string> = { AMAZON: 'Amazon', FLIPKART: 'Flipkart' };

export const FEE_RATIO_ALERT = 35; // % of net revenue
export const RETURN_RATE_ALERT = 10; // %

// ───────────────── Per-marketplace P&L ─────────────────
export function marketplacePL(m: MarketplaceInput, lines: SkuLine[], costFor: ReportInputs['costFor']) {
  const name = MP_NAME[m.marketplace];
  const assumptions: Assumption[] = [];
  const out: Record<string, Line> = {};

  // A. Revenue
  if (m.grossSalesPaise === null) {
    out.netRevenue = { key: 'netRevenue', label: 'Net revenue', paise: null, conf: 'UNAVAILABLE', note: 'Gross sales not provided' };
    assumptions.push({ item: `${name} gross sales`, missing: 'Not provided', impact: 'No P&L can be calculated for this marketplace', confirm: 'Upload the sales / order report', owner: 'SOLLUNA' });
  } else {
    const parts = [m.discountsPaise, m.returnsRefundsPaise];
    const net = m.grossSalesPaise - (m.discountsPaise ?? 0) - (m.returnsRefundsPaise ?? 0) + (m.reimbursementsPaise ?? 0);
    const missing = [m.discountsPaise === null && 'discounts', m.returnsRefundsPaise === null && 'returns/refunds'].filter(Boolean);
    out.netRevenue = { key: 'netRevenue', label: 'Net revenue', paise: net, conf: parts.every((x) => x !== null) ? 'VERIFIED' : 'ESTIMATED', note: missing.length ? `Not deducted (not provided): ${missing.join(', ')}` : undefined };
    if (missing.length) assumptions.push({ item: `${name} ${missing.join(' and ')}`, missing: 'Treated as not deducted', impact: 'Net revenue may be overstated', confirm: 'Provide from the returns / promotions report', owner: 'SOLLUNA' });
  }
  out.grossSales = { key: 'grossSales', label: `Gross product sales (${m.salesBasis.toLowerCase()} basis)`, paise: m.grossSalesPaise, conf: m.grossSalesPaise === null ? 'UNAVAILABLE' : 'VERIFIED' };
  out.discounts = { key: 'discounts', label: 'Less discounts / seller-funded promotions', paise: m.discountsPaise, conf: m.discountsPaise === null ? 'UNAVAILABLE' : 'VERIFIED' };
  out.returns = { key: 'returns', label: 'Less returns / refunds', paise: m.returnsRefundsPaise, conf: m.returnsRefundsPaise === null ? 'UNAVAILABLE' : 'VERIFIED' };
  out.reimbursements = { key: 'reimbursements', label: 'Reimbursements / other revenue', paise: m.reimbursementsPaise, conf: m.reimbursementsPaise === null ? 'UNAVAILABLE' : 'VERIFIED' };

  // B. Direct product costs — only from client-confirmed per-SKU costs; never estimated from averages.
  const mine = lines.filter((l) => l.marketplace === m.marketplace);
  const unitsInLines = mine.reduce((a, l) => a + l.units, 0);
  const noCost = mine.filter((l) => !costFor(l.sku));
  const staffOnly = mine.filter((l) => costFor(l.sku) && !costFor(l.sku)!.clientConfirmed);
  if (!mine.length) {
    out.cogs = { key: 'cogs', label: 'Direct product costs', paise: null, conf: 'UNAVAILABLE', note: 'SKU-wise units not provided' };
    assumptions.push({ item: `${name} SKU-wise sales`, missing: 'Not provided', impact: 'Product cost and product profit cannot be calculated', confirm: 'Provide SKU-level units and sales', owner: 'SOLLUNA' });
  } else if (noCost.length) {
    out.cogs = { key: 'cogs', label: 'Direct product costs', paise: null, conf: 'UNAVAILABLE', note: `Product cost missing for: ${noCost.map((l) => l.sku).join(', ')}` };
    assumptions.push({ item: `${name} product cost`, missing: `No cost for ${noCost.map((l) => l.sku).join(', ')}`, impact: 'Product profit not calculated', confirm: 'Client to enter landed cost per unit for these SKUs', owner: 'Client' });
  } else if (m.unitsSold !== null && unitsInLines < m.unitsSold) {
    out.cogs = { key: 'cogs', label: 'Direct product costs', paise: null, conf: 'UNAVAILABLE', note: `SKU lines cover ${unitsInLines} of ${m.unitsSold} units` };
    assumptions.push({ item: `${name} SKU coverage`, missing: `${m.unitsSold - unitsInLines} units without SKU detail`, impact: 'Product cost would be understated', confirm: 'Complete the SKU-wise sales lines', owner: 'SOLLUNA' });
  } else {
    const cogs = mine.reduce((a, l) => a + l.units * costFor(l.sku)!.costPaise, 0);
    out.cogs = { key: 'cogs', label: 'Direct product costs', paise: cogs, conf: staffOnly.length ? 'ESTIMATED' : 'VERIFIED', note: staffOnly.length ? `Cost entered by SOLLUNA, awaiting client confirmation: ${staffOnly.map((l) => l.sku).join(', ')}` : undefined };
    if (staffOnly.length) assumptions.push({ item: `${name} product cost confirmation`, missing: staffOnly.map((l) => l.sku).join(', '), impact: 'Product profit is provisional', confirm: 'Client to confirm costs', owner: 'Client' });
  }

  // C. Marketplace & fulfilment costs
  const feeBreakdown = FEE_FIELDS.map(([k, label]) => ({ key: k, label, paise: m[k] }));
  const provided = feeBreakdown.filter((f) => f.paise !== null);
  if (m.commissionPaise === null) {
    out.fees = { key: 'fees', label: 'Marketplace & fulfilment costs', paise: null, conf: 'UNAVAILABLE', note: 'Commission / fee data not provided' };
    assumptions.push({ item: `${name} marketplace fees`, missing: 'Not provided', impact: 'Contribution cannot be calculated', confirm: 'Provide the settlement / fee report', owner: 'SOLLUNA' });
  } else {
    const missingFees = feeBreakdown.filter((f) => f.paise === null).map((f) => f.label.toLowerCase());
    out.fees = { key: 'fees', label: 'Marketplace & fulfilment costs', paise: provided.reduce((a, f) => a + f.paise!, 0), conf: missingFees.length ? 'ESTIMATED' : 'VERIFIED', note: missingFees.length ? `Not provided: ${missingFees.join(', ')}` : undefined };
  }

  // D. Marketing
  if (m.adSpendInFees) {
    out.marketing = { key: 'marketing', label: 'Advertising & promotion', paise: 0, conf: 'VERIFIED', note: 'Ad spend is already deducted in marketplace fees — not counted twice' };
  } else if (m.adSpendPaise === null) {
    out.marketing = { key: 'marketing', label: 'Advertising & promotion', paise: null, conf: 'UNAVAILABLE', note: 'Ad spend not provided' };
    assumptions.push({ item: `${name} advertising spend`, missing: 'Not provided', impact: 'Contribution excludes advertising', confirm: 'Provide the advertising report', owner: 'SOLLUNA' });
  } else {
    out.marketing = { key: 'marketing', label: 'Advertising & promotion', paise: m.adSpendPaise, conf: 'VERIFIED' };
  }

  // E. Contribution
  const { netRevenue: nr, cogs, fees, marketing } = out;
  if (nr.paise === null || fees.paise === null) {
    out.contribution = { key: 'contribution', label: 'Contribution before operating expenses', paise: null, conf: 'UNAVAILABLE', note: 'Revenue or fees missing' };
  } else if (cogs.paise === null) {
    out.contribution = { key: 'contribution', label: 'Contribution before operating expenses', paise: null, conf: 'UNAVAILABLE', note: 'Product cost missing — product profit not calculated' };
  } else {
    const value = nr.paise - cogs.paise - fees.paise - (marketing.paise ?? 0);
    out.contribution = {
      key: 'contribution', label: 'Contribution before operating expenses', paise: value,
      conf: marketing.paise === null ? 'ESTIMATED' : worst(nr.conf, cogs.conf, fees.conf, marketing.conf),
      note: marketing.paise === null ? 'Excludes advertising (ad spend not provided)' : undefined,
    };
  }
  // Useful even without product cost — but clearly NOT profit.
  out.beforeProductCost = nr.paise !== null && fees.paise !== null
    ? { key: 'beforeProductCost', label: 'Sales after marketplace fees & ads (before product cost — not profit)', paise: nr.paise - fees.paise - (marketing.paise ?? 0), conf: 'ESTIMATED', note: marketing.paise === null ? 'Excludes advertising' : undefined }
    : { key: 'beforeProductCost', label: 'Sales after marketplace fees & ads (before product cost — not profit)', paise: null, conf: 'UNAVAILABLE' };

  return { lines: out, feeBreakdown, assumptions };
}

// ───────────────── Reconciliation (skill §5, §10) ─────────────────
export type ReconStatus = 'RECONCILED' | 'PARTIALLY_RECONCILED' | 'NOT_RECONCILED' | 'PENDING_SOURCE_DATA';
export function reconcile(m: MarketplaceInput) {
  const base = { marketplace: m.marketplace, settlementPaise: m.settlementPaise, bankCreditPaise: m.bankCreditPaise, reservesPaise: m.reservesPaise };
  if (m.settlementPaise === null) return { ...base, status: 'PENDING_SOURCE_DATA' as ReconStatus, unmatchedPaise: null, note: 'Settlement report not provided' };
  if (m.bankCreditPaise === null) return { ...base, status: 'PENDING_SOURCE_DATA' as ReconStatus, unmatchedPaise: null, note: 'Bank credit not verified — settlement is not treated as received' };
  const unmatched = m.settlementPaise - m.bankCreditPaise - (m.reservesPaise ?? 0);
  if (Math.abs(unmatched) <= 100) return { ...base, status: 'RECONCILED' as ReconStatus, unmatchedPaise: unmatched, note: undefined };
  if (m.bankCreditPaise === 0) return { ...base, status: 'NOT_RECONCILED' as ReconStatus, unmatchedPaise: unmatched, note: 'No bank credit matched yet' };
  return { ...base, status: 'PARTIALLY_RECONCILED' as ReconStatus, unmatchedPaise: unmatched, note: 'Difference may be timing, reserves or unmatched deductions — to be verified (not assumed to be missing money)' };
}

// ───────────────── KPIs (performance skill §6) ─────────────────
export function kpis(m: MarketplaceInput, prev?: MarketplaceInput) {
  return {
    marketplace: m.marketplace,
    grossSalesPaise: m.grossSalesPaise, orders: m.orders, unitsSold: m.unitsSold,
    averageOrderValuePaise: per(m.grossSalesPaise, m.orders),
    averageSellingPricePaise: per(m.grossSalesPaise, m.unitsSold),
    returnRatePct: pct(m.unitsReturned, m.unitsSold),
    cancellationRatePct: pct(m.cancelledOrders, m.orders === null || m.cancelledOrders === null ? null : m.orders + m.cancelledOrders),
    conversionRatePct: pct(m.orders, m.sessions),
    adSpendPaise: m.adSpendPaise, adSalesPaise: m.adSalesPaise,
    acosPct: pct(m.adSpendPaise, m.adSalesPaise), roas: ratio(m.adSalesPaise, m.adSpendPaise), ctrPct: pct(m.clicks, m.impressions),
    momGrossSalesPct: change(m.grossSalesPaise, prev?.grossSalesPaise),
    momOrdersPct: change(m.orders, prev?.orders),
    momUnitsPct: change(m.unitsSold, prev?.unitsSold),
    definitions: {
      cancellationRate: 'cancelled orders ÷ (orders + cancelled orders)',
      conversionRate: 'orders ÷ sessions',
      salesBasis: m.salesBasis,
    },
  };
}

// ───────────────── Report assembly ─────────────────
export interface Assumption { item: string; missing: string; impact: string; confirm: string; owner: 'Client' | 'SOLLUNA' }
export interface Anomaly { title: string; evidence: string; amountPaise: number | null; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; hypothesis: string; action: string; approvalRequired: boolean; priority: 'P1' | 'P2' | 'P3' }

const SUM_KEYS = ['grossSales', 'discounts', 'returns', 'reimbursements', 'netRevenue', 'cogs', 'fees', 'marketing', 'contribution', 'beforeProductCost'];

export function buildReport(input: ReportInputs) {
  const assumptions: Assumption[] = [];
  const anomalies: Anomaly[] = [];
  const perMp = input.marketplaces.map((m) => {
    const r = marketplacePL(m, input.skuLines, input.costFor);
    assumptions.push(...r.assumptions);
    return { marketplace: m.marketplace, salesBasis: m.salesBasis, ...r, reconciliation: reconcile(m), kpis: kpis(m, input.previous.find((p) => p.marketplace === m.marketplace)) };
  });

  // Consolidated: a line is summed only when every included marketplace has it.
  const consolidated: Record<string, Line> = {};
  for (const key of SUM_KEYS) {
    const parts = perMp.map((x) => x.lines[key]);
    const anyNull = parts.some((p) => p.paise === null);
    consolidated[key] = {
      key, label: parts[0]?.label ?? key,
      paise: anyNull || !parts.length ? null : parts.reduce((a, p) => a + p.paise!, 0),
      conf: !parts.length ? 'UNAVAILABLE' : anyNull ? 'UNAVAILABLE' : worst(...parts.map((p) => p.conf)),
      note: anyNull ? `Not available for: ${perMp.filter((x) => x.lines[key].paise === null).map((x) => MP_NAME[x.marketplace]).join(', ')}` : parts.find((p) => p.note)?.note,
    };
  }
  const bases = new Set(perMp.map((x) => x.salesBasis));
  if (bases.size > 1) {
    for (const k of SUM_KEYS) consolidated[k] = { ...consolidated[k], paise: null, conf: 'UNAVAILABLE', note: 'Marketplaces use different sales bases (ordered vs shipped) — not combined' };
  }

  // F. Operating expenses, G. Operating result
  const opexTotal = input.expenses.reduce((a, e) => a + e.amountPaise, 0);
  const opex: Line = input.expensesConfirmed
    ? { key: 'opex', label: 'Operating expenses', paise: opexTotal, conf: 'VERIFIED' }
    : input.expenses.length
      ? { key: 'opex', label: 'Operating expenses', paise: opexTotal, conf: 'ESTIMATED', note: 'Expense list not yet confirmed complete by the client' }
      : { key: 'opex', label: 'Operating expenses', paise: null, conf: 'UNAVAILABLE', note: 'No operating expenses provided' };
  if (!input.expensesConfirmed) assumptions.push({ item: 'Operating expenses', missing: input.expenses.length ? 'Not confirmed complete' : 'Not provided', impact: 'Operating result is partial', confirm: 'Client to add and confirm monthly expenses', owner: 'Client' });

  const c = consolidated.contribution;
  const operatingResult: Line = c.paise === null
    ? { key: 'operatingResult', label: 'Operating result', paise: null, conf: 'UNAVAILABLE', note: c.note ?? 'Contribution not available' }
    : opex.paise === null
      ? { key: 'operatingResult', label: 'Operating result (partial)', paise: c.paise, conf: 'ESTIMATED', note: 'Operating expenses not provided — this is contribution, not final profit' }
      : { key: 'operatingResult', label: 'Operating result', paise: c.paise - opex.paise, conf: worst(c.conf, opex.conf), note: worst(c.conf, opex.conf) === 'VERIFIED' ? undefined : 'Partial — see assumptions' };

  // Reconciliation affects confidence: unreconciled cash keeps the result ESTIMATED at best.
  const recon = perMp.map((x) => x.reconciliation);
  const reconOverall: ReconStatus = !recon.length ? 'PENDING_SOURCE_DATA'
    : recon.every((r) => r.status === 'RECONCILED') ? 'RECONCILED'
      : recon.some((r) => r.status === 'RECONCILED' || r.status === 'PARTIALLY_RECONCILED') ? 'PARTIALLY_RECONCILED'
        : recon.some((r) => r.status === 'NOT_RECONCILED') ? 'NOT_RECONCILED' : 'PENDING_SOURCE_DATA';
  let confidence: Conf = operatingResult.conf;
  if (confidence === 'VERIFIED' && reconOverall !== 'RECONCILED') confidence = 'ESTIMATED';

  // Product-wise profitability (skill §7) — no arbitrary allocation.
  const products = input.skuLines.map((l) => {
    const cost = input.costFor(l.sku);
    const productCost = cost ? cost.costPaise * l.units : null;
    const contribution = productCost !== null && l.feesPaise !== null ? l.netSalesPaise - productCost - l.feesPaise - (l.adSpendPaise ?? 0) : null;
    const provisional = productCost === null || l.feesPaise === null || l.adSpendPaise === null || (cost !== null && !cost.clientConfirmed);
    return {
      marketplace: l.marketplace, sku: l.sku, units: l.units, netSalesPaise: l.netSalesPaise, productCostPaise: productCost,
      feesPaise: l.feesPaise, adsPaise: l.adSpendPaise, contributionPaise: contribution,
      contributionPct: contribution === null ? null : pct(contribution, l.netSalesPaise),
      provisional,
      note: [productCost === null && 'cost missing', l.feesPaise === null && 'fees not mapped to SKU', l.adSpendPaise === null && 'ads not allocated', cost && !cost.clientConfirmed && 'cost not client-confirmed'].filter(Boolean).join('; ') || undefined,
    };
  });

  // Anomalies (skill §11) — evidence first, hypotheses labelled.
  for (const p of products) {
    if (p.contributionPaise !== null && p.contributionPaise < 0) {
      anomalies.push({ title: `${p.sku} (${MP_NAME[p.marketplace]}) sold below known variable cost`, evidence: `Net sales ${inr(p.netSalesPaise)} vs product cost ${inr(p.productCostPaise!)} + fees ${inr(p.feesPaise!)}${p.adsPaise ? ` + ads ${inr(p.adsPaise)}` : ''}`, amountPaise: p.contributionPaise, confidence: p.provisional ? 'MEDIUM' : 'HIGH', hypothesis: 'Price below cost floor, high fees for this size/weight, or heavy discounting (hypothesis)', action: 'Review price floor with profitability-pricing analysis', approvalRequired: true, priority: 'P1' });
    }
  }
  const totalUnits = input.skuLines.reduce((a, l) => a + l.units, 0);
  const noCostUnits = input.skuLines.filter((l) => !input.costFor(l.sku)).reduce((a, l) => a + l.units, 0);
  if (totalUnits > 0 && noCostUnits / totalUnits >= 0.2) {
    anomalies.push({ title: 'Product cost missing for high-volume SKUs', evidence: `${noCostUnits} of ${totalUnits} units (${Math.round((noCostUnits / totalUnits) * 100)}%) have no product cost`, amountPaise: null, confidence: 'HIGH', hypothesis: 'Costs not yet shared', action: 'Client to enter landed cost per unit', approvalRequired: false, priority: 'P1' });
  }
  for (const x of perMp) {
    const nr = x.lines.netRevenue.paise, fees = x.lines.fees.paise;
    if (nr && fees !== null && nr > 0 && (fees / nr) * 100 > FEE_RATIO_ALERT) {
      anomalies.push({ title: `${MP_NAME[x.marketplace]} marketplace fees are ${Math.round((fees / nr) * 100)}% of net revenue`, evidence: `Fees ${inr(fees)} on net revenue ${inr(nr)} (alert above ${FEE_RATIO_ALERT}%)`, amountPaise: fees, confidence: 'MEDIUM', hypothesis: 'Category commission, weight-slab or return-handling charges (hypothesis — verify in fee invoice)', action: 'Audit fee invoice lines and product dimensions', approvalRequired: false, priority: 'P2' });
    }
    const k = x.kpis;
    const contributionBeforeAds = nr !== null && fees !== null && x.lines.cogs.paise !== null ? nr - fees - x.lines.cogs.paise : null;
    if (typeof k.acosPct === 'number' && contributionBeforeAds !== null && nr && nr > 0) {
      const breakEven = Math.round((contributionBeforeAds / nr) * 10000) / 100;
      if (k.acosPct > breakEven) anomalies.push({ title: `${MP_NAME[x.marketplace]} ACOS ${k.acosPct}% is above break-even ${breakEven}%`, evidence: `Ad spend ${inr(x.lines.marketing.paise ?? 0)} for ${inr(k.adSalesPaise ?? 0)} attributed sales`, amountPaise: x.lines.marketing.paise, confidence: 'MEDIUM', hypothesis: 'Broad targeting or low-converting keywords (hypothesis); attributed sales are not necessarily incremental', action: 'Ads review: cut non-converting terms, reset bids to break-even', approvalRequired: true, priority: 'P2' });
    }
    if (typeof k.returnRatePct === 'number' && k.returnRatePct > RETURN_RATE_ALERT) {
      anomalies.push({ title: `${MP_NAME[x.marketplace]} return rate ${k.returnRatePct}%`, evidence: `${x.kpis.unitsSold} units sold, return rate above ${RETURN_RATE_ALERT}%`, amountPaise: x.lines.returns.paise, confidence: 'LOW', hypothesis: 'Listing–product mismatch or quality issue (hypothesis)', action: 'Review return reasons report', approvalRequired: false, priority: 'P3' });
    }
    const r = x.reconciliation;
    if (r.status === 'PARTIALLY_RECONCILED' || r.status === 'NOT_RECONCILED') {
      anomalies.push({ title: `${MP_NAME[x.marketplace]} settlement not fully matched to bank`, evidence: `Settlement ${inr(r.settlementPaise!)}, bank credit ${inr(r.bankCreditPaise!)}, reserves ${inr(r.reservesPaise ?? 0)}`, amountPaise: r.unmatchedPaise, confidence: 'MEDIUM', hypothesis: 'Timing difference or reserve release pending (hypothesis — not assumed to be missing money)', action: 'Match bank credits to settlement IDs; raise a seller-support case if unresolved', approvalRequired: false, priority: 'P1' });
    }
  }

  const actionPlan = [...anomalies].sort((a, b) => a.priority.localeCompare(b.priority)).map((a) => ({
    priority: a.priority, finding: a.title, evidence: a.evidence, action: a.action,
    responsible: /cost/i.test(a.title) && /missing/i.test(a.title) ? 'Client' : 'SOLLUNA', approvalRequired: a.approvalRequired, status: 'OPEN',
  }));

  const pl = {
    period: input.periodLabel,
    gstBasis: 'All amounts exclude GST collected on behalf of the government.',
    marketplaces: perMp.map((x) => ({ marketplace: x.marketplace, salesBasis: x.salesBasis, lines: x.lines, feeBreakdown: x.feeBreakdown })),
    consolidated, opex: { line: opex, items: input.expenses, confirmed: input.expensesConfirmed }, operatingResult,
    products, reconciliation: { status: reconOverall, marketplaces: recon },
    metrics: {
      productCostRatioPct: pct(consolidated.cogs.paise, consolidated.netRevenue.paise),
      marketplaceFeeRatioPct: pct(consolidated.fees.paise, consolidated.netRevenue.paise),
      advertisingRatioPct: pct(consolidated.marketing.paise, consolidated.netRevenue.paise),
      contributionMarginPct: pct(consolidated.contribution.paise, consolidated.netRevenue.paise),
      operatingExpenseRatioPct: pct(opex.paise, consolidated.netRevenue.paise),
    },
    anomalies, assumptions, actionPlan, confidence,
  };
  const performance = {
    period: input.periodLabel,
    marketplaces: perMp.map((x) => x.kpis),
    topProducts: [...products].sort((a, b) => b.netSalesPaise - a.netSalesPaise).slice(0, 10).map((p) => ({ marketplace: p.marketplace, sku: p.sku, units: p.units, netSalesPaise: p.netSalesPaise })),
    recommendations: actionPlan.slice(0, 8),
    dataGaps: assumptions,
    confidence: perMp.length && perMp.every((x) => x.lines.grossSales.paise !== null) ? (assumptions.length ? 'ESTIMATED' : 'VERIFIED') as Conf : 'UNAVAILABLE' as Conf,
  };
  return { pl, performance };
}
