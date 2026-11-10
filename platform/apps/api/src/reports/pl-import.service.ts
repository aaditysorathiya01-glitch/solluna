import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { StorageService } from '../documents/storage.service';
import { DispatcherService } from '../connectors/dispatcher.service';
import { ManagerAgentService } from '../chat/manager-agent.service';
import type { AuthUser } from '../auth/auth.types';
import { readXlsx } from './xlsx';
import { parseFlipkartPl, skuProfit, type FlipkartPl } from './flipkart-pl';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
const periodDate = (period: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new BadRequestException('Period must be YYYY-MM');
  return new Date(`${period}-01T00:00:00Z`);
};
const endOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59));

/**
 * Monthly SKU profit from Flipkart's own Profit and Loss Report (owner, 10 Nov 2026).
 * The team uploads the report; it is parsed in the background (never in the HTTP request); the client's purchase price
 * per SKU is joined in; the manager asks the client for any missing price; the team publishes it to the client.
 */
@Injectable()
export class PlImportService implements OnModuleInit {
  private readonly log = new Logger('PlImport');
  private busy = false;
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
    private readonly dispatch: DispatcherService,
    private readonly agent: ManagerAgentService,
  ) {}

  onModuleInit() {
    setInterval(() => this.tick().catch((e) => this.log.error(e)), 3000).unref();
    this.agent.factProviders.push(async (orgId) => {
      const m = await this.missingCosts(orgId);
      return m ? `Purchase price needed (${monthName(m.period)} Flipkart profit report) for ${m.skus.length} SKU(s): ${m.skus.slice(0, 15).join('; ')}${m.skus.length > 15 ? ' …' : ''}` : null;
    });
  }

  async start(user: AuthUser, orgId: string, period: string, input: unknown) {
    await this.access.assertOrg(user, orgId);
    const periodMonth = periodDate(period);
    const documentId = String((input as { documentId?: string })?.documentId ?? '');
    const doc = await this.db.document.findFirst({ where: { id: documentId, organizationId: orgId, deletedAt: null } });
    if (!doc) throw new NotFoundException('Upload the Flipkart Profit and Loss Report first');
    if (doc.kind !== 'FLIPKART_PL_REPORT') throw new BadRequestException('Choose the Flipkart P&L report document');
    const row = await this.db.plImport.create({ data: { organizationId: orgId, periodMonth, marketplace: 'FLIPKART', documentId, startedById: user.id } });
    await this.audit.log({ actor: user, action: 'report.pl_import', entity: 'PlImport', entityId: row.id, organizationId: orgId, after: { period } });
    setImmediate(() => this.tick().catch((e) => this.log.error(e)));
    return { id: row.id, status: row.status };
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const next = await this.db.plImport.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
        if (!next) return;
        const claimed = await this.db.plImport.updateMany({ where: { id: next.id, status: 'QUEUED' }, data: { status: 'RUNNING' } });
        if (claimed.count) await this.run(next.id);
      }
    } finally { this.busy = false; }
  }

  private async run(id: string) {
    const row = await this.db.plImport.findUniqueOrThrow({ where: { id } });
    const period = row.periodMonth.toISOString().slice(0, 7);
    try {
      const doc = await this.db.document.findUniqueOrThrow({ where: { id: row.documentId } });
      const pl = parseFlipkartPl(readXlsx(await this.storage.get(doc.fileKey)));
      if (pl.periodFrom && pl.periodFrom.slice(0, 7) !== period) throw new Error(`This report is for ${pl.periodFrom} to ${pl.periodTo}, not ${monthName(period)}.`);
      await this.db.plImport.update({ where: { id }, data: { status: 'DONE', data: pl as unknown as Prisma.InputJsonValue, finishedAt: new Date() } });
      const view = skuProfit(pl, await this.costLookup(row.organizationId, row.periodMonth));
      if (view.missingCost.length) {
        // The manager asks the client for the missing purchase prices (one message, the SKUs listed).
        await this.agent.enqueue(row.organizationId, `The ${monthName(period)} Flipkart profit report is being prepared. Purchase price per unit is missing for ${view.missingCost.length} SKU(s): ${view.missingCost.slice(0, 15).join('; ')}${view.missingCost.length > 15 ? ' …' : ''}. Ask the client for each purchase price per unit (₹, and whether it includes GST) and save each with save_product_cost. They can also enter them in Reports → Product costs.`);
      }
    } catch (e) {
      await this.db.plImport.update({ where: { id }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 300), finishedAt: new Date() } });
    }
  }

  /** Latest effective purchase price per SKU for the month (SKU match ignores case and spacing). */
  async costLookup(orgId: string, periodMonth: Date) {
    const rows = await this.db.productCost.findMany({ where: { organizationId: orgId, effectiveFrom: { lte: endOfMonth(periodMonth) } }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    const key = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const map = new Map<string, number>();
    for (const r of rows) if (!map.has(key(r.sku))) map.set(key(r.sku), r.costPaise);
    return (sku: string) => map.get(key(sku)) ?? null;
  }

  /** The month's SKU profit table. Clients only see a published one. */
  async view(user: AuthUser, orgId: string, period: string) {
    await this.access.assertOrg(user, orgId);
    const periodMonth = periodDate(period);
    const row = await this.db.plImport.findFirst({ where: { organizationId: orgId, periodMonth, ...(user.type === 'CUSTOMER' ? { publishedAt: { not: null } } : {}) }, orderBy: { createdAt: 'desc' } });
    if (!row) return null;
    const base = { id: row.id, period, label: monthName(period), status: row.status, error: row.error, published: Boolean(row.publishedAt) };
    if (row.status !== 'DONE' || !row.data) return base;
    const pl = row.data as unknown as FlipkartPl;
    const view = skuProfit(pl, await this.costLookup(orgId, periodMonth));
    return { ...base, periodFrom: pl.periodFrom, periodTo: pl.periodTo, completenessPct: pl.completenessPct, summary: pl.summary, ...view };
  }

  async publish(user: AuthUser, orgId: string, period: string) {
    await this.access.assertOrg(user, orgId);
    if (user.type !== 'STAFF') throw new ForbiddenException();
    const row = await this.db.plImport.findFirst({ where: { organizationId: orgId, periodMonth: periodDate(period), status: 'DONE' }, orderBy: { createdAt: 'desc' } });
    if (!row) throw new BadRequestException('Import the Flipkart P&L report first');
    await this.db.plImport.update({ where: { id: row.id }, data: { publishedAt: new Date(), publishedById: user.id } });
    await this.audit.log({ actor: user, action: 'report.pl_published', entity: 'PlImport', entityId: row.id, organizationId: orgId, after: { period } });
    await this.dispatch.emit({ type: 'report.published', organizationId: orgId, title: `${monthName(period)} Flipkart profit report`, body: 'Your SKU-wise profit for the month is ready in Reports.', data: { period } });
    await this.agent.enqueue(orgId, `The ${monthName(period)} Flipkart SKU profit report is published in Reports (sale = Flipkart's bank settlement, minus the purchase price). Tell the client briefly and offer to explain it.`);
    return { published: true };
  }

  async csv(user: AuthUser, orgId: string, period: string) {
    const v = await this.view(user, orgId, period);
    if (!v || !('rows' in v)) throw new NotFoundException('No profit report for this month');
    const r = (p: number | null) => (p === null ? '' : (p / 100).toFixed(2));
    const lines = [['SKU', 'Gross units', 'Returned & cancelled', 'Net units', 'Purchase per unit', 'Purchase amount', 'Sale per unit', 'Sale amount (bank settlement)', 'Profit', 'Amount settled', 'Amount pending'].join(',')];
    for (const x of v.rows) lines.push([`"${x.sku.replace(/"/g, '""')}"`, x.grossUnits, x.returnedUnits, x.netUnits, r(x.purchasePerUnitPaise), r(x.purchaseAmountPaise), r(x.salePerUnitPaise), r(x.saleAmountPaise), r(x.profitPaise), r(x.settledPaise), r(x.pendingPaise)].join(','));
    lines.push(['TOTAL', '', '', v.total.netUnits, '', r(v.total.purchaseAmountPaise), '', r(v.total.saleAmountPaise), r(v.total.profitPaise), '', ''].join(','));
    lines.push(`"Profit is ${v.confidence}. ${v.reasons.join(' ')}"`);
    return { fileName: `flipkart-sku-profit-${period}.csv`, csv: lines.join('\n') };
  }

  /** For the manager's facts: SKUs of the latest imported month still missing a purchase price. */
  async missingCosts(orgId: string) {
    const row = await this.db.plImport.findFirst({ where: { organizationId: orgId, status: 'DONE' }, orderBy: { periodMonth: 'desc' } });
    if (!row?.data) return null;
    const view = skuProfit(row.data as unknown as FlipkartPl, await this.costLookup(orgId, row.periodMonth));
    return view.missingCost.length ? { period: row.periodMonth.toISOString().slice(0, 7), skus: view.missingCost } : null;
  }
}
