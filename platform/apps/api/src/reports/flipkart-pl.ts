import type { Cell, Workbook } from './xlsx';

/**
 * Flipkart "Profit and Loss Report" (Seller Hub → Reports → Report Center → New Report → Payment Reports → Profit and
 * Loss Report). Reads the Overall Summary and the SKU-level P&L sheets by their header names, so column moves in a
 * future Flipkart version do not silently shift numbers; a missing header fails loudly.
 * All money in paise (integers).
 */
export interface FlipkartSku {
  sku: string; grossUnits: number; returnedUnits: number; netUnits: number;
  accountedNetSalesPaise: number; totalExpensesPaise: number; bankSettlementPaise: number; netEarningsPaise: number;
  settledPaise: number; pendingPaise: number;
}
export interface FlipkartPl {
  periodFrom: string | null; periodTo: string | null; generatedOn: string | null;
  /** Flipkart's own "Accounting & Collection in progress [98.2% Completed]" note; 100 when absent. */
  completenessPct: number;
  summary: Record<string, number>; // paise, by Flipkart's line label (e.g. "Gross Sales", "• Commission Fee")
  skus: FlipkartSku[];
}

const paise = (v: Cell) => (typeof v === 'number' ? Math.round(v * 100) : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : 0);
const num = (v: Cell) => (typeof v === 'number' ? v : typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : 0);
const norm = (s: Cell) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function parseFlipkartPl(wb: Workbook): FlipkartPl {
  const summarySheet = wb['Overall Summary'];
  const skuSheet = wb['SKU-level P&L'];
  if (!summarySheet || !skuSheet) throw new Error('This is not a Flipkart Profit and Loss Report (sheets "Overall Summary" and "SKU-level P&L" not found).');

  let periodFrom: string | null = null, periodTo: string | null = null, generatedOn: string | null = null, completenessPct = 100;
  const summary: Record<string, number> = {};
  for (const row of summarySheet) {
    const label = String(row[0] ?? '').trim();
    if (!label) continue;
    if (/orders rec(ie|ei)ved during/i.test(label)) { const m = /(\d{4}-\d{2}-\d{2})\s*to\s*(\d{4}-\d{2}-\d{2})/.exec(String(row[1] ?? '')); if (m) [periodFrom, periodTo] = [m[1], m[2]]; continue; }
    if (/generated on/i.test(label)) { generatedOn = String(row[1] ?? '').slice(0, 10) || null; continue; }
    const pct = /\[(\d+(?:\.\d+)?)%\s*completed\]/i.exec(label);
    if (pct) { completenessPct = Number(pct[1]); continue; }
    if (typeof row[1] === 'number') summary[label.replace(/\s+/g, ' ')] = paise(row[1]);
  }

  const header = skuSheet[0] ?? [];
  const col = (name: string) => {
    const i = header.findIndex((h) => norm(h) === norm(name));
    if (i < 0) throw new Error(`Flipkart P&L: column "${name}" not found — the report format may have changed.`);
    return i;
  };
  const c = {
    sku: col('SKU ID'), gross: col('Gross Units (#)'), ret: col('Returned & Cancelled Units'), net: col('Net Units (#)'),
    sales: col('Accounted Net Sales (Seller Price)'), exp: col('Total Expenses (INR)'), bank: col('Bank Settlement [Projected] (INR)'),
    earn: col('Net Earnings (INR)'), settled: col('Amount Settled (INR)'), pending: col('Amount Pending (INR)'),
  };
  const skus: FlipkartSku[] = [];
  for (const row of skuSheet.slice(2)) {
    const sku = String(row[c.sku] ?? '').trim();
    if (!sku || /^total/i.test(sku)) continue;
    skus.push({
      sku, grossUnits: num(row[c.gross]), returnedUnits: num(row[c.ret]), netUnits: num(row[c.net]),
      accountedNetSalesPaise: paise(row[c.sales]), totalExpensesPaise: paise(row[c.exp]), bankSettlementPaise: paise(row[c.bank]),
      netEarningsPaise: paise(row[c.earn]), settledPaise: paise(row[c.settled]), pendingPaise: paise(row[c.pending]),
    });
  }
  if (!skus.length) throw new Error('Flipkart P&L: no SKU rows found.');
  return { periodFrom, periodTo, generatedOn, completenessPct, summary, skus };
}

export interface SkuProfitRow extends FlipkartSku {
  /** Client's purchase price per unit (paise); null = not given yet. */
  purchasePerUnitPaise: number | null; purchaseAmountPaise: number | null;
  /** Sale = Flipkart's projected bank settlement (what reaches the bank after fees and taxes). */
  salePerUnitPaise: number | null; saleAmountPaise: number;
  profitPaise: number | null;
}

/** Owner's columns (10 Nov 2026): purchase per unit, purchase amount, sale per unit, sale amount, profit. */
export function skuProfit(pl: FlipkartPl, costFor: (sku: string) => number | null) {
  const rows: SkuProfitRow[] = pl.skus.map((s) => {
    const cost = costFor(s.sku);
    const purchaseAmount = cost === null ? null : cost * s.netUnits;
    return {
      ...s, purchasePerUnitPaise: cost, purchaseAmountPaise: purchaseAmount,
      salePerUnitPaise: s.netUnits > 0 ? Math.round(s.bankSettlementPaise / s.netUnits) : null, saleAmountPaise: s.bankSettlementPaise,
      profitPaise: purchaseAmount === null ? null : s.bankSettlementPaise - purchaseAmount,
    };
  });
  const missingCost = rows.filter((r) => r.purchasePerUnitPaise === null && r.netUnits > 0).map((r) => r.sku);
  const total = {
    netUnits: rows.reduce((a, r) => a + r.netUnits, 0),
    saleAmountPaise: rows.reduce((a, r) => a + r.saleAmountPaise, 0),
    purchaseAmountPaise: rows.reduce((a, r) => a + (r.purchaseAmountPaise ?? 0), 0),
    profitPaise: rows.reduce((a, r) => a + (r.profitPaise ?? 0), 0),
  };
  // CLAUDE.md rule 7: never show verified profit with missing costs or incomplete marketplace data.
  const confidence = missingCost.length ? (rows.some((r) => r.profitPaise !== null) ? 'ESTIMATED' : 'UNAVAILABLE') : pl.completenessPct < 100 ? 'ESTIMATED' : 'VERIFIED';
  const reasons = [
    ...(missingCost.length ? [`Purchase price missing for ${missingCost.length} SKU(s) — their profit is not counted.`] : []),
    ...(pl.completenessPct < 100 ? [`Flipkart marks this report ${pl.completenessPct}% complete (accounting & collection in progress).`] : []),
  ];
  return { rows, missingCost, total, confidence, reasons };
}
