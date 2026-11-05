// Unit tests for the P&L / performance engine against hand-calculated figures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildReport, marketplacePL, reconcile, change } = require('../dist/apps/api/src/reports/engine.js');

const amazon = (o = {}) => ({
  marketplace: 'AMAZON', salesBasis: 'SHIPPED',
  grossSalesPaise: 10_000_000, discountsPaise: 500_000, returnsRefundsPaise: 300_000, reimbursementsPaise: 100_000,
  orders: 90, unitsSold: 100, unitsReturned: 5, cancelledOrders: 10, sessions: 3000,
  commissionPaise: 1_500_000, fixedFeesPaise: 100_000, fulfilmentPaise: 300_000, shippingPaise: 100_000, storagePaise: 0, otherFeesPaise: 0,
  adSpendPaise: 300_000, adSalesPaise: 1_500_000, impressions: 50_000, clicks: 1_000, adSpendInFees: false,
  settlementPaise: 7_000_000, bankCreditPaise: 6_900_000, reservesPaise: 100_000, ...o,
});
const lines = [
  { marketplace: 'AMAZON', sku: 'A1', units: 60, netSalesPaise: 6_000_000, feesPaise: 1_200_000, adSpendPaise: 200_000 },
  { marketplace: 'AMAZON', sku: 'A2', units: 40, netSalesPaise: 3_300_000, feesPaise: 800_000, adSpendPaise: 100_000 },
];
const costs = { A1: { costPaise: 40_000, clientConfirmed: true, includesGst: false }, A2: { costPaise: 30_000, clientConfirmed: true, includesGst: false } };
const base = (o = {}) => ({ periodLabel: 'October 2026', marketplaces: [amazon()], previous: [], skuLines: lines, costFor: (s) => costs[s] ?? null, expenses: [{ category: 'RENT', description: 'Warehouse', amountPaise: 1_000_000 }], expensesConfirmed: true, ...o });

test('complete, reconciled data → exact P&L and VERIFIED', () => {
  const { pl } = buildReport(base());
  const l = pl.marketplaces[0].lines;
  assert.equal(l.netRevenue.paise, 9_300_000);   // 1,00,000 − 5,000 − 3,000 + 1,000
  assert.equal(l.cogs.paise, 3_600_000);         // 60×400 + 40×300
  assert.equal(l.fees.paise, 2_000_000);
  assert.equal(l.marketing.paise, 300_000);
  assert.equal(l.contribution.paise, 3_400_000);
  assert.equal(pl.operatingResult.paise, 2_400_000);
  assert.equal(pl.operatingResult.conf, 'VERIFIED');
  assert.equal(pl.confidence, 'VERIFIED');
  assert.equal(pl.reconciliation.status, 'RECONCILED');
  assert.equal(pl.metrics.contributionMarginPct, 36.56);
  assert.deepEqual(pl.products.map((p) => p.contributionPaise), [2_200_000, 1_200_000]);
  assert.equal(pl.anomalies.length, 0);
  assert.equal(pl.assumptions.length, 0);
});

test('missing product cost → no product profit; useful pre-cost line is labelled "not profit"', () => {
  const { pl } = buildReport(base({ costFor: (s) => (s === 'A1' ? costs.A1 : null) }));
  const l = pl.marketplaces[0].lines;
  assert.equal(l.cogs.paise, null);
  assert.equal(l.contribution.paise, null);
  assert.equal(l.contribution.conf, 'UNAVAILABLE');
  assert.equal(pl.operatingResult.paise, null);
  assert.equal(pl.confidence, 'UNAVAILABLE');
  assert.equal(l.beforeProductCost.paise, 9_300_000 - 2_000_000 - 300_000);
  assert.match(l.beforeProductCost.label, /not profit/);
  assert.ok(pl.assumptions.some((a) => a.owner === 'Client' && /A2/.test(a.missing)));
  assert.ok(pl.anomalies.some((a) => a.title === 'Product cost missing for high-volume SKUs' && a.priority === 'P1'), '40% of units without cost');
});

test('missing ad spend → contribution shown but ESTIMATED and "excludes advertising"', () => {
  const { pl } = buildReport(base({ marketplaces: [amazon({ adSpendPaise: null, adSalesPaise: null })] }));
  const c = pl.marketplaces[0].lines.contribution;
  assert.equal(c.paise, 9_300_000 - 3_600_000 - 2_000_000);
  assert.equal(c.conf, 'ESTIMATED');
  assert.match(c.note, /Excludes advertising/);
  assert.equal(pl.confidence, 'ESTIMATED');
});

test('ad spend already inside marketplace fees is not counted twice', () => {
  const { pl } = buildReport(base({ marketplaces: [amazon({ adSpendInFees: true })] }));
  assert.equal(pl.marketplaces[0].lines.marketing.paise, 0);
  assert.equal(pl.marketplaces[0].lines.contribution.paise, 3_700_000);
});

test('expenses not confirmed → operating result partial; none at all → contribution, not profit', () => {
  let { pl } = buildReport(base({ expensesConfirmed: false }));
  assert.equal(pl.operatingResult.paise, 2_400_000);
  assert.equal(pl.operatingResult.conf, 'ESTIMATED');
  ({ pl } = buildReport(base({ expensesConfirmed: false, expenses: [] })));
  assert.equal(pl.operatingResult.paise, 3_400_000);
  assert.match(pl.operatingResult.label, /partial/);
  assert.match(pl.operatingResult.note, /not final profit/);
});

test('reconciliation: never "received" without a bank credit; mismatches downgrade confidence', () => {
  assert.equal(reconcile(amazon({ bankCreditPaise: null })).status, 'PENDING_SOURCE_DATA');
  assert.match(reconcile(amazon({ bankCreditPaise: null })).note, /not treated as received/);
  assert.equal(reconcile(amazon({ settlementPaise: null })).status, 'PENDING_SOURCE_DATA');
  assert.equal(reconcile(amazon({ bankCreditPaise: 0, reservesPaise: 0 })).status, 'NOT_RECONCILED');
  const partial = reconcile(amazon({ bankCreditPaise: 6_500_000 }));
  assert.equal(partial.status, 'PARTIALLY_RECONCILED');
  assert.equal(partial.unmatchedPaise, 400_000);
  const { pl } = buildReport(base({ marketplaces: [amazon({ bankCreditPaise: 6_500_000 })] }));
  assert.equal(pl.operatingResult.conf, 'VERIFIED', 'P&L figures themselves are complete');
  assert.equal(pl.confidence, 'ESTIMATED', 'but overall confidence is not VERIFIED while cash is unreconciled');
  assert.ok(pl.anomalies.some((a) => /settlement not fully matched/.test(a.title) && /not assumed to be missing money/.test(a.hypothesis)));
});

test('metrics: divide-by-zero and baselines', () => {
  const { performance } = buildReport(base({ marketplaces: [amazon({ orders: 0, sessions: 0, adSalesPaise: 0 })], previous: [amazon({ grossSalesPaise: 8_000_000, orders: null, unitsSold: 0 })] }));
  const k = performance.marketplaces[0];
  assert.equal(k.averageOrderValuePaise, 'NOT_MEANINGFUL');
  assert.equal(k.conversionRatePct, 'NOT_MEANINGFUL');
  assert.equal(k.acosPct, 'NOT_MEANINGFUL');
  assert.equal(k.momGrossSalesPct, 25);
  assert.equal(k.momOrdersPct, 'NO_BASELINE');
  assert.equal(k.momUnitsPct, 'NEW');
  assert.equal(change(5, 5), 0);
  const fresh = buildReport(base()).performance.marketplaces[0];
  assert.equal(fresh.momGrossSalesPct, 'NO_BASELINE');
  assert.equal(fresh.returnRatePct, 5);
  assert.equal(fresh.cancellationRatePct, 10);   // 10 ÷ (90 + 10)
  assert.equal(fresh.ctrPct, 2);
  assert.equal(fresh.roas, 5);
});

test('Amazon + Flipkart: consolidated only when both have the line; mixed sales basis never combined', () => {
  const fk = amazon({ marketplace: 'FLIPKART', grossSalesPaise: 2_000_000, discountsPaise: 0, returnsRefundsPaise: 0, reimbursementsPaise: 0, commissionPaise: 400_000, fixedFeesPaise: 0, fulfilmentPaise: 0, shippingPaise: 0, storagePaise: 0, otherFeesPaise: 0, unitsSold: null, adSpendPaise: null });
  let { pl } = buildReport(base({ marketplaces: [amazon(), fk] }));
  assert.equal(pl.consolidated.grossSales.paise, 12_000_000);
  assert.equal(pl.consolidated.fees.paise, 2_400_000);
  assert.equal(pl.consolidated.cogs.paise, null, 'Flipkart has no SKU lines');
  assert.match(pl.consolidated.cogs.note, /Flipkart/);
  ({ pl } = buildReport(base({ marketplaces: [amazon(), { ...fk, salesBasis: 'ORDERED' }] })));
  assert.equal(pl.consolidated.grossSales.paise, null);
  assert.match(pl.consolidated.grossSales.note, /different sales bases/);
});

test('anomalies: SKU below cost and ACOS above break-even, with evidence and approval flags', () => {
  const badLines = [{ ...lines[0], netSalesPaise: 2_000_000 }, lines[1]];
  const { pl } = buildReport(base({ skuLines: badLines, marketplaces: [amazon({ grossSalesPaise: 5_600_000, adSpendPaise: 1_500_000, adSalesPaise: 2_000_000 })] }));
  const below = pl.anomalies.find((a) => /A1 \(Amazon\) sold below known variable cost/.test(a.title));
  assert.ok(below);
  assert.equal(below.amountPaise, 2_000_000 - 2_400_000 - 1_200_000 - 200_000);
  assert.equal(below.approvalRequired, true, 'price changes need client approval');
  assert.ok(pl.anomalies.some((a) => /ACOS 75% is above break-even/.test(a.title)));
  assert.equal(pl.actionPlan[0].priority, 'P1');
});

test('cost entered by SOLLUNA but not confirmed by the client → ESTIMATED and provisional', () => {
  const { pl } = buildReport(base({ costFor: (s) => ({ ...costs[s], clientConfirmed: s !== 'A2' }) }));
  assert.equal(pl.marketplaces[0].lines.cogs.conf, 'ESTIMATED');
  assert.equal(pl.confidence, 'ESTIMATED');
  assert.equal(pl.products.find((p) => p.sku === 'A2').provisional, true);
  assert.ok(pl.assumptions.some((a) => /confirmation/.test(a.item)));
});

test('SKU lines covering fewer units than sold → product cost not calculated', () => {
  const r = marketplacePL(amazon({ unitsSold: 150 }), lines, (s) => costs[s]);
  assert.equal(r.lines.cogs.paise, null);
  assert.match(r.lines.cogs.note, /cover 100 of 150 units/);
});
