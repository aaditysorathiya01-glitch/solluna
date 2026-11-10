import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Marketplace, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { parse } from '../common/zod';
import { EntitlementsService } from '../features/entitlements.service';
import { DispatcherService } from '../connectors/dispatcher.service';
import type { AuthUser } from '../auth/auth.types';
import { buildReport, type CostInfo, type MarketplaceInput } from './engine';

export const KIND_FEATURE = { PERFORMANCE: 'MONTHLY_PERFORMANCE_REPORT', PL: 'MONTHLY_PL_REPORT' } as const;
type Kind = keyof typeof KIND_FEATURE;

const paise = z.number().int().min(0).max(1e12).nullable().optional();
const count = z.number().int().min(0).max(1e9).nullable().optional();
const MonthSchema = z.object({
  salesBasis: z.enum(['SHIPPED', 'ORDERED']).default('SHIPPED'),
  grossSalesPaise: paise, discountsPaise: paise, returnsRefundsPaise: paise, reimbursementsPaise: paise,
  orders: count, unitsSold: count, unitsReturned: count, cancelledOrders: count, sessions: count,
  commissionPaise: paise, fixedFeesPaise: paise, fulfilmentPaise: paise, shippingPaise: paise, storagePaise: paise, otherFeesPaise: paise,
  adSpendPaise: paise, adSalesPaise: paise, impressions: count, clicks: count, adSpendInFees: z.boolean().default(false),
  settlementPaise: paise, bankCreditPaise: paise, reservesPaise: paise,
  sourceNote: z.string().trim().max(500).optional(),
});
const SkuLinesSchema = z.object({
  lines: z.array(z.object({
    sku: z.string().trim().min(1).max(60), units: z.number().int().min(0), netSalesPaise: z.number().int(),
    feesPaise: z.number().int().min(0).nullable().optional(), adSpendPaise: z.number().int().min(0).nullable().optional(),
  })).max(5000),
});
const CostSchema = z.object({
  sku: z.string().trim().min(1).max(60), costPaise: z.number().int().min(1), includesGst: z.boolean().default(false),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const ExpenseSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  category: z.enum(['STAFF', 'RENT', 'SOFTWARE', 'PROFESSIONAL', 'TRANSPORT', 'OTHER']),
  description: z.string().trim().min(2).max(200), amountPaise: z.number().int().min(1), documentId: z.string().optional(),
});

/** "2026-10" → 2026-10-01T00:00Z (rejects malformed or future months). */
export function periodDate(period: string): Date {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!m) throw new BadRequestException('Period must be YYYY-MM');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  if (d > new Date()) throw new BadRequestException('Period cannot be in the future');
  return d;
}
const prevMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
const label = (d: Date) => d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const endOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59));

/** ca-documentation-support §3/§8: documents expected in a monthly CA pack. */
const CA_REQUIRED: { key: string; label: string; kinds: string[]; marketplace?: Marketplace; category: string }[] = [
  { key: 'AMAZON_SETTLEMENT', label: 'Amazon settlement report', kinds: ['AMAZON_SETTLEMENT'], marketplace: 'AMAZON', category: 'Marketplace settlement' },
  { key: 'FLIPKART_SETTLEMENT', label: 'Flipkart settlement / payment report', kinds: ['FLIPKART_SETTLEMENT'], marketplace: 'FLIPKART', category: 'Marketplace settlement' },
  // Owner's monthly marketplace files (10 Nov 2026), downloaded by SOLLUNA from the seller panels.
  { key: 'FLIPKART_GSTR_REPORT', label: 'Flipkart GSTR return report', kinds: ['FLIPKART_GSTR_REPORT'], marketplace: 'FLIPKART', category: 'TCS / TDS / tax statement' },
  { key: 'FLIPKART_SALES_REPORT', label: 'Flipkart sales report', kinds: ['FLIPKART_SALES_REPORT'], marketplace: 'FLIPKART', category: 'Marketplace sales' },
  { key: 'FLIPKART_TDS', label: 'Flipkart TDS report', kinds: ['FLIPKART_TDS'], marketplace: 'FLIPKART', category: 'TCS / TDS / tax statement' },
  { key: 'AMAZON_MTR_B2B', label: 'Amazon Merchant Tax Report (B2B)', kinds: ['AMAZON_MTR_B2B'], marketplace: 'AMAZON', category: 'TCS / TDS / tax statement' },
  { key: 'AMAZON_MTR_B2C', label: 'Amazon Merchant Tax Report (B2C)', kinds: ['AMAZON_MTR_B2C'], marketplace: 'AMAZON', category: 'TCS / TDS / tax statement' },
  { key: 'AMAZON_FEE_INVOICE', label: 'Amazon seller fee invoices', kinds: ['AMAZON_FEE_INVOICE'], marketplace: 'AMAZON', category: 'Marketplace fee / service invoice' },
  { key: 'PURCHASE_INVOICE', label: 'Purchase invoices', kinds: ['PURCHASE_INVOICE', 'INVOICE'], category: 'Purchase / inward supply' },
  { key: 'EXPENSE_INVOICE', label: 'Expense invoices', kinds: ['EXPENSE_INVOICE'], category: 'Expense' },
  { key: 'BANK_STATEMENT', label: 'Bank statement / payment credits', kinds: ['BANK_STATEMENT'], category: 'Bank / payment evidence' },
];
const CA_STATUS_LABEL: Record<string, string> = {
  VERIFIED_READABLE: 'Verified for readability', DUPLICATE: 'Duplicate', INCOMPLETE: 'Incomplete',
  OUTSIDE_PERIOD: 'Outside requested period', CA_REVIEW_REQUIRED: 'CA review required',
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly ent: EntitlementsService,
    private readonly dispatch: DispatcherService,
  ) {}

  /**
   * Reporting access. Same as general client access, plus: Accounts Executives prepare monthly reports
   * for every client with a current subscription (role: "Payments, P&L and CA documents"). This widens
   * reporting only — not chat or other client areas.
   */
  private async assertReporting(user: AuthUser, orgId: string) {
    if (user.type === 'STAFF' && user.staffRole === 'ACCOUNTS_EXECUTIVE') {
      const sub = await this.ent.currentSubscription(orgId);
      if (sub) return;
    }
    await this.access.assertOrg(user, orgId);
  }

  /** Clients this staff member can prepare reports for. */
  async reportingClients(user: AuthUser) {
    const ids = user.staffRole === 'ACCOUNTS_EXECUTIVE'
      ? (await this.db.subscription.findMany({ where: { status: { in: ['ACTIVE', 'GRACE_PERIOD'] } }, select: { organizationId: true } })).map((s) => s.organizationId)
      : await this.access.staffOrgIds(user);
    const orgs = await this.db.organization.findMany({
      where: ids ? { id: { in: ids } } : {}, orderBy: { legalName: 'asc' },
      include: { subscriptions: { where: { status: { in: ['ACTIVE', 'GRACE_PERIOD'] } }, include: { plan: { select: { name: true } } } } },
    });
    return orgs.map((o) => ({ id: o.id, name: o.brandName ?? o.legalName, plan: o.subscriptions[0]?.plan.name ?? null }));
  }

  // ─────────── Staff data entry (marketplace figures from marketplace reports) ───────────

  async upsertMonth(user: AuthUser, orgId: string, period: string, marketplace: string, input: unknown) {
    await this.assertReporting(user, orgId);
    const mp = z.enum(['AMAZON', 'FLIPKART']).parse(marketplace) as Marketplace;
    const d = parse(MonthSchema, input);
    const periodMonth = periodDate(period);
    const data = { ...d, enteredById: user.id };
    const row = await this.db.marketplaceMonth.upsert({
      where: { organizationId_periodMonth_marketplace: { organizationId: orgId, periodMonth, marketplace: mp } },
      update: data, create: { ...data, organizationId: orgId, periodMonth, marketplace: mp },
    });
    await this.audit.log({ actor: user, action: 'report.inputs_update', entity: 'MarketplaceMonth', entityId: row.id, organizationId: orgId, after: { period, marketplace: mp } });
    return row;
  }

  async replaceSkuLines(user: AuthUser, orgId: string, period: string, marketplace: string, input: unknown) {
    await this.assertReporting(user, orgId);
    const mp = z.enum(['AMAZON', 'FLIPKART']).parse(marketplace) as Marketplace;
    const { lines } = parse(SkuLinesSchema, input);
    const dup = lines.map((l) => l.sku).find((s, i, a) => a.indexOf(s) !== i);
    if (dup) throw new BadRequestException(`Duplicate SKU line: ${dup}`); // skill §5.4
    const periodMonth = periodDate(period);
    await this.db.$transaction([
      this.db.skuMonthLine.deleteMany({ where: { organizationId: orgId, periodMonth, marketplace: mp } }),
      this.db.skuMonthLine.createMany({ data: lines.map((l) => ({ ...l, feesPaise: l.feesPaise ?? null, adSpendPaise: l.adSpendPaise ?? null, organizationId: orgId, periodMonth, marketplace: mp })) }),
    ]);
    await this.audit.log({ actor: user, action: 'report.sku_lines_replace', entity: 'SkuMonthLine', organizationId: orgId, after: { period, marketplace: mp, count: lines.length } });
    return { count: lines.length };
  }

  // ─────────── Client inputs: product costs, expenses ───────────

  async addCost(user: AuthUser, orgId: string, input: unknown) {
    await this.assertReporting(user, orgId);
    const d = parse(CostSchema, input);
    const row = await this.db.productCost.create({
      data: { organizationId: orgId, sku: d.sku, costPaise: d.costPaise, includesGst: d.includesGst, effectiveFrom: new Date(`${d.effectiveFrom}T00:00:00Z`), clientConfirmed: user.type === 'CUSTOMER', enteredById: user.id },
    });
    await this.audit.log({ actor: user, action: 'product_cost.add', entity: 'ProductCost', entityId: row.id, organizationId: orgId, after: { sku: d.sku, costPaise: d.costPaise, by: user.type } });
    return row;
  }

  /** Latest effective cost per SKU (as of a date) — never silently reuses an older cost when a newer one exists. */
  async costs(user: AuthUser, orgId: string, asOf = new Date()) {
    await this.assertReporting(user, orgId);
    const rows = await this.db.productCost.findMany({ where: { organizationId: orgId, effectiveFrom: { lte: asOf } }, orderBy: [{ sku: 'asc' }, { effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.sku)) latest.set(r.sku, r);
    return [...latest.values()];
  }

  async addExpense(user: AuthUser, orgId: string, input: unknown) {
    await this.assertReporting(user, orgId);
    const d = parse(ExpenseSchema, input);
    if (d.documentId) {
      const doc = await this.db.document.findFirst({ where: { id: d.documentId, organizationId: orgId, deletedAt: null } });
      if (!doc) throw new BadRequestException('Supporting document not found');
    }
    const periodMonth = periodDate(d.period);
    const confirmed = await this.db.reportMonth.findUnique({ where: { organizationId_periodMonth: { organizationId: orgId, periodMonth } } });
    if (confirmed?.expensesConfirmed) throw new BadRequestException('Expenses for this month are confirmed — reopen them first');
    return this.db.operatingExpense.create({ data: { organizationId: orgId, periodMonth, category: d.category, description: d.description, amountPaise: d.amountPaise, documentId: d.documentId, enteredById: user.id } });
  }

  async listExpenses(user: AuthUser, orgId: string, period: string) {
    await this.assertReporting(user, orgId);
    const periodMonth = periodDate(period);
    const [items, month] = await Promise.all([
      this.db.operatingExpense.findMany({ where: { organizationId: orgId, periodMonth }, orderBy: { createdAt: 'asc' } }),
      this.db.reportMonth.findUnique({ where: { organizationId_periodMonth: { organizationId: orgId, periodMonth } } }),
    ]);
    return { items, confirmed: month?.expensesConfirmed ?? false };
  }

  async deleteExpense(user: AuthUser, orgId: string, id: string) {
    await this.assertReporting(user, orgId);
    const e = await this.db.operatingExpense.findFirst({ where: { id, organizationId: orgId } });
    if (!e) throw new NotFoundException('Expense not found');
    const month = await this.db.reportMonth.findUnique({ where: { organizationId_periodMonth: { organizationId: orgId, periodMonth: e.periodMonth } } });
    if (month?.expensesConfirmed) throw new BadRequestException('Expenses for this month are confirmed — reopen them first');
    await this.db.operatingExpense.delete({ where: { id } });
    return { deleted: true };
  }

  /** Only the client can confirm their expense list is complete (it is their business information). */
  async confirmExpenses(user: AuthUser, period: string, confirmed: boolean) {
    if (user.type !== 'CUSTOMER') throw new ForbiddenException('Only the client can confirm their expenses');
    const periodMonth = periodDate(period);
    const orgId = user.organizationId!;
    await this.db.reportMonth.upsert({
      where: { organizationId_periodMonth: { organizationId: orgId, periodMonth } },
      update: { expensesConfirmed: confirmed, confirmedById: user.id, confirmedAt: new Date() },
      create: { organizationId: orgId, periodMonth, expensesConfirmed: confirmed, confirmedById: user.id, confirmedAt: new Date() },
    });
    await this.audit.log({ actor: user, action: confirmed ? 'expenses.confirm' : 'expenses.reopen', entity: 'ReportMonth', organizationId: orgId, after: { period } });
    return { period, confirmed };
  }

  // ─────────── Compute, generate, publish ───────────

  private async inputs(orgId: string, periodMonth: Date) {
    const [months, previous, skuLines, month, expenses] = await Promise.all([
      this.db.marketplaceMonth.findMany({ where: { organizationId: orgId, periodMonth }, orderBy: { marketplace: 'asc' } }),
      this.db.marketplaceMonth.findMany({ where: { organizationId: orgId, periodMonth: prevMonth(periodMonth) } }),
      this.db.skuMonthLine.findMany({ where: { organizationId: orgId, periodMonth }, orderBy: [{ marketplace: 'asc' }, { sku: 'asc' }] }),
      this.db.reportMonth.findUnique({ where: { organizationId_periodMonth: { organizationId: orgId, periodMonth } } }),
      this.db.operatingExpense.findMany({ where: { organizationId: orgId, periodMonth } }),
    ]);
    // Cost effective for the reporting month = latest cost effective on or before month end.
    const costRows = await this.db.productCost.findMany({ where: { organizationId: orgId, effectiveFrom: { lte: endOfMonth(periodMonth) } }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    const costMap = new Map<string, CostInfo>();
    for (const c of costRows) if (!costMap.has(c.sku)) costMap.set(c.sku, { costPaise: c.costPaise, clientConfirmed: c.clientConfirmed, includesGst: c.includesGst });
    return {
      raw: { months, skuLines, expenses, expensesConfirmed: month?.expensesConfirmed ?? false, costs: [...costMap.entries()].map(([sku, c]) => ({ sku, ...c })) },
      engine: {
        periodLabel: label(periodMonth),
        marketplaces: months as unknown as MarketplaceInput[],
        previous: previous as unknown as MarketplaceInput[],
        skuLines: skuLines.map((l) => ({ marketplace: l.marketplace, sku: l.sku, units: l.units, netSalesPaise: l.netSalesPaise, feesPaise: l.feesPaise, adSpendPaise: l.adSpendPaise })),
        costFor: (sku: string) => costMap.get(sku) ?? null,
        expenses: expenses.map((e) => ({ category: e.category, description: e.description, amountPaise: e.amountPaise })),
        expensesConfirmed: month?.expensesConfirmed ?? false,
      },
    };
  }

  async workbench(user: AuthUser, orgId: string, period: string) {
    await this.assertReporting(user, orgId);
    const periodMonth = periodDate(period);
    const { raw, engine } = await this.inputs(orgId, periodMonth);
    const reports = await this.db.monthlyReport.findMany({ where: { organizationId: orgId, periodMonth }, orderBy: [{ kind: 'asc' }, { version: 'desc' }], select: { id: true, kind: true, version: true, status: true, confidence: true, createdAt: true, publishedAt: true } });
    return { period, periodLabel: label(periodMonth), inputs: raw, preview: engine.marketplaces.length ? buildReport(engine) : null, reports };
  }

  async generate(user: AuthUser, orgId: string, period: string, input: unknown) {
    await this.assertReporting(user, orgId);
    const { kind } = parse(z.object({ kind: z.enum(['PERFORMANCE', 'PL']) }), input);
    const e = await this.ent.context(orgId);
    const r = this.ent.check(e, KIND_FEATURE[kind]);
    if (!r.allowed) throw new ForbiddenException(`Client is not entitled to this report (${r.reason})`);
    const periodMonth = periodDate(period);
    const { engine } = await this.inputs(orgId, periodMonth);
    if (!engine.marketplaces.length) throw new BadRequestException('Enter at least one marketplace\'s monthly figures first');
    const built = buildReport(engine);
    const section = kind === 'PL' ? built.pl : built.performance;
    const last = await this.db.monthlyReport.findFirst({ where: { organizationId: orgId, periodMonth, kind }, orderBy: { version: 'desc' } });
    const report = await this.db.monthlyReport.create({
      data: { organizationId: orgId, periodMonth, kind, version: (last?.version ?? 0) + 1, confidence: section.confidence, data: { ...section, kind } as unknown as Prisma.InputJsonValue, generatedById: user.id },
    });
    await this.audit.log({ actor: user, action: 'report.generate', entity: 'MonthlyReport', entityId: report.id, organizationId: orgId, after: { kind, period, version: report.version, confidence: report.confidence } });
    return report;
  }

  async publish(user: AuthUser, id: string) {
    const report = await this.db.monthlyReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    await this.assertReporting(user, report.organizationId);
    if (report.status !== 'DRAFT') throw new BadRequestException(`Report is already ${report.status.toLowerCase()}`);
    await this.db.$transaction([
      this.db.monthlyReport.updateMany({ where: { organizationId: report.organizationId, periodMonth: report.periodMonth, kind: report.kind, status: 'PUBLISHED' }, data: { status: 'SUPERSEDED' } }),
      this.db.monthlyReport.update({ where: { id }, data: { status: 'PUBLISHED', publishedById: user.id, publishedAt: new Date() } }),
    ]);
    await this.audit.log({ actor: user, action: 'report.publish', entity: 'MonthlyReport', entityId: id, organizationId: report.organizationId, after: { kind: report.kind, version: report.version } });
    const name = report.kind === 'PL' ? 'P&L report' : 'business performance report';
    await this.dispatch.emit({
      type: 'report.published', organizationId: report.organizationId,
      title: `Your ${label(report.periodMonth)} ${name} is ready`,
      body: `Confidence: ${report.confidence.toLowerCase()}. ${report.confidence === 'VERIFIED' ? 'All inputs were complete and reconciled.' : 'Some figures are estimated or unavailable — see "Missing data" in the report for what we need from you.'}`,
      data: { reportId: id },
    });
    return this.db.monthlyReport.findUniqueOrThrow({ where: { id } });
  }

  // ─────────── Viewing & export ───────────

  async list(user: AuthUser, orgId: string) {
    await this.assertReporting(user, orgId);
    return this.db.monthlyReport.findMany({
      where: { organizationId: orgId, ...(user.type === 'CUSTOMER' ? { status: 'PUBLISHED' } : {}) },
      orderBy: [{ periodMonth: 'desc' }, { kind: 'asc' }, { version: 'desc' }],
      select: { id: true, kind: true, periodMonth: true, version: true, status: true, confidence: true, publishedAt: true },
    });
  }

  async get(user: AuthUser, id: string) {
    const report = await this.db.monthlyReport.findUnique({ where: { id }, include: { organization: { select: { legalName: true, brandName: true } } } });
    if (!report) throw new NotFoundException('Report not found');
    try { await this.assertReporting(user, report.organizationId); } catch { throw new NotFoundException('Report not found'); }
    if (user.type === 'CUSTOMER' && report.status !== 'PUBLISHED') throw new NotFoundException('Report not found');
    return { ...report, periodLabel: label(report.periodMonth) };
  }

  /** CSV (opens in Excel / Google Sheets). Amounts in rupees. Unavailable values are blank with status, never 0. */
  async exportCsv(user: AuthUser, id: string) {
    const r = await this.get(user, id);
    const d = r.data as Record<string, any>;
    const rs = (p: number | null | undefined) => (p === null || p === undefined ? '' : (p / 100).toFixed(2));
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows: unknown[][] = [[`${r.organization.brandName ?? r.organization.legalName} — ${r.kind === 'PL' ? 'P&L' : 'Business performance'} — ${r.periodLabel} (v${r.version}, ${r.status})`], [`Confidence: ${r.confidence}`]];
    if (r.kind === 'PL') {
      rows.push([d.gstBasis], [], ['Section', 'Line', 'Amount (INR)', 'Status', 'Note']);
      const shown = (ls: Record<string, any>) => Object.values(ls).filter((l: any) => !(l.key === 'beforeProductCost' && ls.contribution?.paise !== null));
      for (const m of d.marketplaces) for (const l of shown(m.lines) as any[]) rows.push([m.marketplace, l.label, rs(l.paise), l.conf, l.note ?? '']);
      for (const l of shown(d.consolidated) as any[]) rows.push(['CONSOLIDATED', l.label, rs(l.paise), l.conf, l.note ?? '']);
      rows.push(['CONSOLIDATED', d.opex.line.label, rs(d.opex.line.paise), d.opex.line.conf, d.opex.line.note ?? '']);
      rows.push(['CONSOLIDATED', d.operatingResult.label, rs(d.operatingResult.paise), d.operatingResult.conf, d.operatingResult.note ?? '']);
      rows.push([], ['Marketplace', 'SKU', 'Units', 'Net sales', 'Product cost', 'Fees', 'Ads', 'Contribution', 'Contribution %', 'Provisional', 'Note']);
      for (const p of d.products) rows.push([p.marketplace, p.sku, p.units, rs(p.netSalesPaise), rs(p.productCostPaise), rs(p.feesPaise), rs(p.adsPaise), rs(p.contributionPaise), p.contributionPct ?? '', p.provisional ? 'Yes' : 'No', p.note ?? '']);
      rows.push([], ['Missing data / assumption', 'Missing or assumed', 'Impact', 'Required confirmation', 'Owner']);
      for (const a of d.assumptions) rows.push([a.item, a.missing, a.impact, a.confirm, a.owner]);
    } else {
      rows.push([], ['Marketplace', 'Gross sales', 'Orders', 'Units', 'AOV', 'ASP', 'Return %', 'Cancellation %', 'Conversion %', 'Ad spend', 'ACOS %', 'ROAS', 'CTR %', 'MoM sales %']);
      for (const k of d.marketplaces) rows.push([k.marketplace, rs(k.grossSalesPaise), k.orders, k.unitsSold, typeof k.averageOrderValuePaise === 'number' ? rs(k.averageOrderValuePaise) : k.averageOrderValuePaise, typeof k.averageSellingPricePaise === 'number' ? rs(k.averageSellingPricePaise) : k.averageSellingPricePaise, k.returnRatePct, k.cancellationRatePct, k.conversionRatePct, rs(k.adSpendPaise), k.acosPct, k.roas, k.ctrPct, k.momGrossSalesPct]);
    }
    return { fileName: `SOLLUNA_${r.kind}_${r.periodMonth.toISOString().slice(0, 7)}_v${r.version}.csv`, csv: '﻿' + rows.map((row) => row.map(esc).join(',')).join('\r\n') };
  }

  // ─────────── CA documentation pack (ca-documentation-support §8–§10) ───────────

  async caPack(user: AuthUser, orgId: string, period: string) {
    await this.assertReporting(user, orgId);
    const e = await this.ent.context(orgId);
    if (!this.ent.check(e, 'CA_DOCUMENTATION').allowed) throw new ForbiddenException('CA documentation support is not active on this plan');
    const periodMonth = periodDate(period);
    const [org, docs, months, pl] = await Promise.all([
      this.db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { legalName: true, gstin: true } }),
      this.db.document.findMany({ where: { organizationId: orgId, periodMonth, deletedAt: null, visibility: 'CLIENT' }, orderBy: { createdAt: 'asc' } }),
      this.db.marketplaceMonth.findMany({ where: { organizationId: orgId, periodMonth }, select: { marketplace: true } }),
      this.db.monthlyReport.findFirst({ where: { organizationId: orgId, periodMonth, kind: 'PL', status: 'PUBLISHED' }, select: { id: true, version: true, confidence: true } }),
    ]);
    const active = months.length ? new Set(months.map((m) => m.marketplace)) : new Set<Marketplace>(['AMAZON', 'FLIPKART']);
    const required = CA_REQUIRED.filter((r) => !r.marketplace || active.has(r.marketplace));
    let sr = 0;
    const index: { sr: number; document: string; source: string; category: string; period: string; reference: string; documentId: string | null; status: string }[] = [];
    const missing: { required: string; period: string; requestedFrom: string; status: string }[] = [];
    for (const req of required) {
      const found = docs.filter((d) => req.kinds.includes(d.kind));
      if (!found.length) { missing.push({ required: req.label, period: label(periodMonth), requestedFrom: 'Client', status: 'Missing' }); continue; }
      for (const d of found) index.push({ sr: ++sr, document: d.title || d.fileName, source: req.label, category: req.category, period: label(periodMonth), reference: d.fileName, documentId: d.id, status: d.caStatus ? CA_STATUS_LABEL[d.caStatus] ?? d.caStatus : 'Received' });
    }
    if (pl) index.push({ sr: ++sr, document: `Monthly marketplace P&L (v${pl.version}, ${pl.confidence.toLowerCase()})`, source: 'SOLLUNA', category: 'Reconciliation schedules', period: label(periodMonth), reference: pl.id, documentId: null, status: 'Received' });
    else missing.push({ required: 'Monthly marketplace P&L', period: label(periodMonth), requestedFrom: 'SOLLUNA', status: 'Missing' });
    const caQuestions = index.filter((i) => i.status === 'CA review required').map((i) => `${i.document}: classification / tax treatment needs CA review`);
    return {
      client: org, period: label(periodMonth), marketplaces: [...active],
      index, missing, caQuestions, plReportId: pl?.id ?? null,
      complete: missing.length === 0,
      disclaimer: 'SOLLUNA organizes marketplace records for your Chartered Accountant. "Verified for readability" is not a certification of legal validity, tax eligibility or accounting treatment. Tax filing, audit and certification are not included.',
    };
  }

  async setDocumentCa(user: AuthUser, id: string, input: unknown) {
    const d = parse(z.object({
      caStatus: z.enum(['VERIFIED_READABLE', 'DUPLICATE', 'INCOMPLETE', 'OUTSIDE_PERIOD', 'CA_REVIEW_REQUIRED']).nullable().optional(),
      period: z.string().optional(),
    }), input);
    const doc = await this.db.document.findUnique({ where: { id } });
    if (!doc || doc.deletedAt) throw new NotFoundException('Document not found');
    await this.assertReporting(user, doc.organizationId);
    const updated = await this.db.document.update({
      where: { id },
      data: { ...(d.caStatus !== undefined ? { caStatus: d.caStatus } : {}), ...(d.period ? { periodMonth: periodDate(d.period) } : {}) },
      select: { id: true, caStatus: true, periodMonth: true },
    });
    await this.audit.log({ actor: user, action: 'document.ca_status', entity: 'Document', entityId: id, organizationId: doc.organizationId, after: d });
    return updated;
  }
}
