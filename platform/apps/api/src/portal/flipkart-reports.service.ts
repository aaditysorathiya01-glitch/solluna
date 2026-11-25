import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import type { Page } from 'playwright-core';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { StorageService } from '../documents/storage.service';
import { OrdersPlService } from '../reports/orders-pl.service';
import { PipelineService } from '../chat/pipeline.service';
import { ManagerAgentService } from '../chat/manager-agent.service';
import { DispatcherService } from '../connectors/dispatcher.service';
import { CaFilesService, lastMonthIst, monthLabel } from '../reports/ca-files.service';
import type { AuthUser } from '../auth/auth.types';
import { PortalBotService } from './portal-bot.service';

/**
 * Flipkart report files by the portal bot (owner, 25 Nov 2026). For month M, on/after the 25th of M+1 (IST):
 *   Orders report (Fulfilment Reports → Orders) for M, Settled Transactions (Payment Reports) for M and for M+1 1st–20th.
 * Requested in Reports Centre through direct links (custom date range), then checked after 2, 10, 30 minutes and every
 * 30 minutes; each file is taken from Flipkart's own download response when its row says Generated. With all three the
 * order-wise P&L is built as a draft for the team to review and publish.
 * CA files (owner, 25 Nov 2026), same method from the 5th: Tax Reports → GSTR return report, Sales Report and TDS for the
 * whole of last month; they go into the client's CA pack and the CA pipeline's team step is completed.
 */
type Kind = 'ORDERS' | 'SETTLEMENT' | 'GSTR' | 'SALES' | 'TDS';
type Purpose = 'PL' | 'CA';
interface FileSpec { kind: Kind; from: string; to: string; requestedAt?: string; documentId?: string }
const RC = 'https://seller.flipkart.com/index.html#dashboard/metrics/report-centre?query=';
const link = (type: string | null, sub: string | null) => RC + encodeURIComponent(JSON.stringify({
  one_time_request: { reportGroup: null, reportName: null, enable: true, status: null },
  repeat_request: { repeat_report_group_name: null, repeat_report_name: null, repeat_enable: false },
  pagination: { page_size: 10, starting_page: 1 },
  request_report: { create_request: Boolean(type), report_type: type, report_subtype: sub, repeat_report: false },
}));
const LINKS: Record<Kind, string> = { ORDERS: link('Fulfilment Reports', 'Orders'), SETTLEMENT: link('Payment Reports', 'Settled Transactions'), GSTR: link('Tax Reports', 'GSTR return report'), SALES: link('Tax Reports', 'Sales Report'), TDS: link('Tax Reports', 'TDS') };
const LIST = link(null, null);
const SUBTYPE: Record<Kind, string> = { ORDERS: 'Orders', SETTLEMENT: 'Settled Transactions', GSTR: 'GSTR return report', SALES: 'Sales Report', TDS: 'TDS' };
const DOC_KIND: Record<Kind, string> = { ORDERS: 'FLIPKART_ORDERS_REPORT', SETTLEMENT: 'FLIPKART_SETTLEMENT_REPORT', GSTR: 'FLIPKART_GSTR_REPORT', SALES: 'FLIPKART_SALES_REPORT', TDS: 'FLIPKART_TDS' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
const ymd = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) });
/** Reports Centre writes ranges as "Oct 1 2026 To Oct 31 2026". */
const rowRange = (f: FileSpec) => { const a = ymd(f.from), b = ymd(f.to); return `${SHORT[a.m - 1]} ${a.d} ${a.y} To ${SHORT[b.m - 1]} ${b.d} ${b.y}`; };
/** Backoff after a request: 2, 10, 30 minutes, then every 30 minutes; give up after 48 hours. */
const WAIT_MIN = [2, 10, 30];

export function filesFor(period: string, purpose: Purpose = 'PL'): FileSpec[] {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  if (purpose === 'CA') return (['GSTR', 'SALES', 'TDS'] as Kind[]).map((kind) => ({ kind, from: `${period}-01`, to: last }));
  return [
    { kind: 'ORDERS', from: `${period}-01`, to: last },
    { kind: 'SETTLEMENT', from: `${period}-01`, to: last },
    { kind: 'SETTLEMENT', from: `${next}-01`, to: `${next}-20` },
  ];
}

/** The month to fetch on a given day (IST): last month — P&L files from the 25th (100% settled), CA files from the 5th. */
export function dueMonth(now = new Date(), purpose: Purpose = 'PL') {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  if (ist.getUTCDate() < (purpose === 'CA' ? 5 : 25)) return null;
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}

@Injectable()
export class FlipkartReportsService implements OnModuleInit {
  private readonly log = new Logger('FlipkartReportsBot');
  private running = false;
  constructor(
    private readonly db: PrismaService, private readonly audit: AuditService, private readonly storage: StorageService,
    private readonly bot: PortalBotService, private readonly opl: OrdersPlService, private readonly pipelines: PipelineService,
    private readonly agent: ManagerAgentService, private readonly dispatch: DispatcherService, private readonly ca: CaFilesService,
  ) {}

  onModuleInit() {
    this.agent.caFiles = (orgId, mp, period) => this.managerCa(orgId, mp, period);
    setInterval(() => this.tick().catch((e) => this.log.warn(`tick: ${(e as Error).message}`)), 60_000).unref();
  }

  /** Every minute: open this month's fetches for connected Flipkart clients (from the 25th), then run what is due. */
  async tick(now = new Date()) {
    if (this.running || !this.bot.configured || process.env.PORTAL_BOT_REPORTS === 'off') return;
    this.running = true;
    try {
      for (const purpose of ['CA', 'PL'] as Purpose[]) {
        const period = dueMonth(now, purpose);
        if (!period) continue;
        const orgs = await this.db.marketplaceAccount.findMany({ where: { marketplace: 'FLIPKART', status: 'CONNECTED', organization: { subscriptions: { some: { status: { in: ['ACTIVE', 'GRACE_PERIOD'] } } } } }, select: { organizationId: true } });
        for (const o of orgs) await this.db.reportFetch.upsert({ where: { organizationId_marketplace_purpose_period: { organizationId: o.organizationId, marketplace: 'FLIPKART', purpose, period } }, create: { organizationId: o.organizationId, purpose, period, files: filesFor(period, purpose) as unknown as Prisma.InputJsonValue }, update: {} });
      }
      const due = await this.db.reportFetch.findMany({ where: { status: { in: ['REQUEST', 'WAITING'] }, nextAt: { lte: now } }, orderBy: { nextAt: 'asc' }, take: 3 });
      for (const f of due) await this.run(f.id).catch((e) => this.log.warn(`fetch ${f.id}: ${(e as Error).message}`));
    } finally { this.running = false; }
  }

  /** Super admin: start (or restart) a month for one client now. */
  async start(user: AuthUser, orgId: string, period: string, purpose: Purpose = 'PL') {
    if (!/^\d{4}-\d{2}$/.test(period)) throw new BadRequestException('Period must be YYYY-MM');
    if (!['PL', 'CA'].includes(purpose)) throw new BadRequestException('Purpose must be PL or CA');
    const row = await this.db.reportFetch.upsert({
      where: { organizationId_marketplace_purpose_period: { organizationId: orgId, marketplace: 'FLIPKART', purpose, period } },
      create: { organizationId: orgId, purpose, period, files: filesFor(period, purpose) as unknown as Prisma.InputJsonValue },
      update: { status: 'REQUEST', files: filesFor(period, purpose) as unknown as Prisma.InputJsonValue, checks: 0, nextAt: new Date(), error: null, ordersPlId: null },
    });
    await this.audit.log({ actor: user, action: 'portal_bot.report_fetch', entity: 'ReportFetch', entityId: row.id, organizationId: orgId, after: { period, purpose } });
    setImmediate(() => this.tick().catch(() => undefined));
    return row;
  }

  list() { return this.db.reportFetch.findMany({ orderBy: { updatedAt: 'desc' }, take: 30 }); }

  private async run(id: string) {
    const row = await this.db.reportFetch.findUniqueOrThrow({ where: { id } });
    const files = row.files as unknown as FileSpec[];
    const opened = await this.bot.openPage('ops-flipkart');
    try {
      const page = () => opened.holder.page;
      await this.bot.flipkartLogin(page());
      if (row.status === 'REQUEST') {
        for (const f of files) if (!f.requestedAt) { await this.request(page(), f); f.requestedAt = new Date().toISOString(); }
        await this.db.reportFetch.update({ where: { id }, data: { status: 'WAITING', files: files as unknown as Prisma.InputJsonValue, checks: 0, nextAt: new Date(Date.now() + WAIT_MIN[0] * 60_000), error: null } });
        await this.audit.log({ action: 'portal_bot.reports_requested', entity: 'ReportFetch', entityId: id, organizationId: row.organizationId, after: { period: row.period, files: files.map((f) => `${f.kind} ${f.from}..${f.to}`) } });
        return;
      }
      // WAITING: download whatever is generated.
      for (const f of files) if (!f.documentId) {
        const buf = await this.download(page(), f);
        if (buf) f.documentId = await this.save(row.organizationId, row.period, f, buf);
      }
      const done = files.every((f) => f.documentId);
      const checks = row.checks + 1;
      if (done) {
        const ordersPlId = row.purpose === 'PL' ? await this.opl.startSystem(row.organizationId, row.period, files.map((f) => f.documentId!)) : null;
        await this.db.reportFetch.update({ where: { id }, data: { status: 'DONE', files: files as unknown as Prisma.InputJsonValue, checks, ordersPlId } });
        if (row.purpose === 'CA') await this.caDone(row.organizationId, row.period);
        return;
      }
      const ageH = (Date.now() - row.createdAt.getTime()) / 3_600_000;
      if (ageH > 48) { await this.db.reportFetch.update({ where: { id }, data: { status: 'FAILED', files: files as unknown as Prisma.InputJsonValue, checks, error: 'Flipkart had not generated every report after 48 hours' } }); return; }
      const wait = WAIT_MIN[checks] ?? 30;
      await this.db.reportFetch.update({ where: { id }, data: { files: files as unknown as Prisma.InputJsonValue, checks, nextAt: new Date(Date.now() + wait * 60_000), error: null } });
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0].slice(0, 300);
      // A failed attempt is retried in 30 minutes (Flipkart pages are sometimes slow); the reason stays visible.
      await this.db.reportFetch.update({ where: { id }, data: { error: msg, nextAt: new Date(Date.now() + 30 * 60_000) } });
      throw e;
    } finally { await opened.close(); }
  }

  /** Direct link → date field → custom → first and last day → SUBMIT. */
  private async request(page: Page, f: FileSpec) {
    await page.goto(LINKS[f.kind], { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByText('Select Date Range').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await this.bot.dismissPopups(page);
    const field = page.locator('label[for="dateRange"] ~ div .form-control').first();
    const a = ymd(f.from), b = ymd(f.to);
    const want = [`${SHORT[a.m - 1]} ${String(a.d).padStart(2, '0')}, ${a.y}`, `${SHORT[b.m - 1]} ${String(b.d).padStart(2, '0')}, ${b.y}`];
    const shown = async () => (await field.innerText().catch(() => '')).replace(/\s+/g, ' ');
    // Flipkart pre-fills last month; when that is the range wanted, nothing to pick.
    const pre = await shown();
    if (!want.every((w) => pre.includes(w))) {
      await field.click({ timeout: 10_000 });
      await page.waitForTimeout(800);
      const custom = page.locator('button:has-text("custom")').first();
      const wholeMonth = f.from.slice(0, 7) === f.to.slice(0, 7) && a.d === 1 && b.d === new Date(Date.UTC(b.y, b.m, 0)).getUTCDate();
      if (await custom.isVisible().catch(() => false)) {
        await custom.click({ timeout: 10_000 });
        await page.waitForTimeout(800);
        for (const day of [f.from, f.to]) await this.pickDay(page, day);
      } else if (wholeMonth) {
        // Monthly tiles only (some tax reports): year header, then the month tile.
        await page.locator(`text=/^${SHORT[a.m - 1]}$/`).first().click({ timeout: 10_000 });
        await page.waitForTimeout(600);
      } else throw new Error('Flipkart offers no custom dates for this report');
    }
    const now = await shown();
    if (!want.every((w) => now.includes(w))) throw new Error(`Date range not set (wanted ${want.join(' – ')}, Flipkart shows "${now}")`);
    await page.getByRole('button', { name: /^submit$/i }).first().click({ timeout: 10_000 });
    await page.waitForTimeout(4000);
  }

  /** react-dates calendar: the day cell's aria-label names the full date; step back a month if it is not shown. */
  private async pickDay(page: Page, date: string) {
    const { y, m, d } = ymd(date);
    const cell = page.locator(`td[role="button"][aria-label*="${MONTHS[m - 1]} ${d}, ${y}"]`).first();
    for (let i = 0; i < 4; i++) {
      if (await cell.isVisible().catch(() => false)) { await cell.click(); await page.waitForTimeout(500); return; }
      await page.locator('[aria-label*="previous month" i], .DayPickerNavigation_leftButton__horizontalDefault, div[type="prev"]').first().click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(600);
    }
    throw new Error(`Day ${date} not found in Flipkart's calendar`);
  }

  /** Requested reports list: newest matching row that says Generated → Download → the file from Flipkart's response. */
  private async download(page: Page, f: FileSpec): Promise<Buffer | null> {
    await page.goto(LIST, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('tr[data-testid^="one-time-request-table-row-"]').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const rows = page.locator('tr[data-testid^="one-time-request-table-row-"]');
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const text = (await rows.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ');
      // Any generated request for exactly this report and range will do (the same data); others are still being made.
      if (!text.includes(SUBTYPE[f.kind]) || !text.includes(`${rowRange(f)} `) && !text.endsWith(rowRange(f)) || !/Generated/i.test(text)) continue;
      const resp = page.waitForResponse((r) => r.url().includes('/napi/metrics/bizReport/downloadReport/') && r.status() === 200, { timeout: 60_000 });
      await rows.nth(i).getByRole('button', { name: /download/i }).first().click({ timeout: 10_000 });
      const buf = await (await resp).body();
      if (buf.length < 20) throw new Error(`Flipkart download for ${SUBTYPE[f.kind]} ${rowRange(f)} is empty`);
      return buf;
    }
    return null; // not generated yet (or not on the first page)
  }

  /**
   * Manager chat (owner, 25 Nov 2026): last month → the client downloads it from Reports themselves; an older month →
   * fetched the same way and delivered as a download in Notifications.
   */
  private async managerCa(orgId: string, mp: 'FLIPKART' | 'AMAZON', period: string) {
    const last = lastMonthIst();
    if (period > last) return `${monthLabel(period)} is not over yet; its CA files come on the 5th of the next month. Tell the client.`;
    if (period < new Date(Date.UTC(Number(last.slice(0, 4)) - 2, Number(last.slice(5, 7)) - 1, 1)).toISOString().slice(0, 7)) return 'That month is more than two years back; escalate_to_team so the team checks what the marketplace still has.';
    if (period === last) return `This is last month: tell the client to open Reports → "Send reports to your CA", choose ${mp === 'FLIPKART' ? 'Flipkart' : 'Amazon'}, and download all files in one click.`;
    if (mp === 'AMAZON') return 'Amazon CA files are not fetched automatically yet; escalate_to_team so the team prepares them, and tell the client the team will share them.';
    const have = await this.ca.files(orgId, mp, period);
    if (have.every((f) => f.id)) { await this.notifyCa(orgId, mp, period); return `The ${monthLabel(period)} Flipkart CA files are ready: a download was put in the client's Notifications. Tell them to download it from the Notifications tab.`; }
    const row = await this.db.reportFetch.upsert({
      where: { organizationId_marketplace_purpose_period: { organizationId: orgId, marketplace: 'FLIPKART', purpose: 'CA', period } },
      create: { organizationId: orgId, purpose: 'CA', period, files: filesFor(period, 'CA') as unknown as Prisma.InputJsonValue },
      update: { status: 'REQUEST', files: filesFor(period, 'CA') as unknown as Prisma.InputJsonValue, checks: 0, nextAt: new Date(), error: null },
    });
    await this.audit.log({ action: 'portal_bot.report_fetch', entity: 'ReportFetch', entityId: row.id, organizationId: orgId, after: { period, purpose: 'CA', by: 'manager-chat' } });
    setImmediate(() => this.tick().catch(() => undefined));
    return `Requested the ${monthLabel(period)} Flipkart CA files (GSTR return, Sales, TDS) from Flipkart. They usually arrive within minutes, sometimes a few hours. Tell the client they will get a notification with the download in the Notifications tab.`;
  }

  private async notifyCa(orgId: string, mp: 'FLIPKART' | 'AMAZON', period: string) {
    const name = mp === 'FLIPKART' ? 'Flipkart' : 'Amazon';
    await this.dispatch.emit({ type: 'ca.files_ready', organizationId: orgId, title: `${monthLabel(period)} ${name} CA files are ready`, body: `GSTR return report, Sales report and TDS report for ${monthLabel(period)}: one download for your CA.`, link: `/api/reports/ca-files.zip?mp=${mp}&period=${period}`, data: { period, marketplace: mp } });
  }

  /** CA files are in: the CA pipeline's team step for that month is done (the manager then tells the client). */
  private async caDone(orgId: string, period: string) {
    await this.notifyCa(orgId, 'FLIPKART', period);
    // An older month was asked for in chat: the manager tells the client it is in Notifications.
    if (period !== lastMonthIst()) await this.agent.enqueue(orgId, `The ${monthLabel(period)} Flipkart CA files the client asked for are ready as a download in their Notifications tab. Tell them briefly.`);
    const runs = await this.db.pipelineRun.findMany({ where: { organizationId: orgId, pipeline: 'CA_DOCUMENTATION', branch: 'FLIPKART_CA', status: 'ACTIVE' } });
    for (const r of runs.filter((x) => (x.data as Record<string, string>)?.period === period)) {
      await this.pipelines.teamAdvance(null, orgId, r.id, {}).catch((e) => this.log.warn(`CA pipeline ${r.id}: ${(e as Error).message}`));
    }
    await this.audit.log({ action: 'portal_bot.ca_files', entity: 'Organization', entityId: orgId, organizationId: orgId, after: { period } });
  }

  private async save(orgId: string, period: string, f: FileSpec, buf: Buffer) {
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const zip = buf.subarray(0, 2).toString() === 'PK';
    const xlsx = zip && buf.includes(Buffer.from('xl/workbook'));
    const ext = xlsx ? 'xlsx' : zip ? 'zip' : buf.subarray(0, 4).toString() === '%PDF' ? 'pdf' : 'csv';
    const mime = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip', pdf: 'application/pdf', csv: 'text/csv' }[ext];
    const name = `flipkart-${SUBTYPE[f.kind].toLowerCase().replace(/\s+/g, '-')}-${f.from}-to-${f.to}.${ext}`;
    const ca = ['GSTR', 'SALES', 'TDS'].includes(f.kind);
    const doc = await this.db.$transaction(async (tx) => {
      const fileKey = await this.storage.put(buf, tx);
      return tx.document.create({ data: { organizationId: orgId, kind: DOC_KIND[f.kind], title: `Flipkart ${SUBTYPE[f.kind]} ${f.from} to ${f.to}`, fileName: name, visibility: ca ? 'CLIENT' : 'INTERNAL', fileKey, sha256, mimeType: mime, sizeBytes: buf.length, uploadedById: 'portal-bot', periodMonth: new Date(`${period}-01T00:00:00Z`) } });
    });
    await this.audit.log({ action: 'document.upload', entity: 'Document', entityId: doc.id, organizationId: orgId, after: { kind: doc.kind, size: buf.length, sha256, by: 'portal-bot' } });
    return doc.id;
  }
}
