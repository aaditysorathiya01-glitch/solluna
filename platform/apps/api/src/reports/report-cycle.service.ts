import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { DispatcherService } from '../connectors/dispatcher.service';

/**
 * Monthly report cycle (owner, 7 Nov 2026):
 *   month ends → Amazon and Flipkart publish the month's reports on the 5th → SOLLUNA prepares the client's report
 *   from that data (edited where needed) → ready by REPORT_READY_DAY.
 * On/after the 5th (IST) one monthly-reporting request is opened per client, once per month.
 */
export const MARKETPLACE_REPORT_DAY = Number(process.env.REPORT_MARKETPLACE_DAY ?? 5);
export const REPORT_READY_DAY = Number(process.env.REPORT_READY_DAY ?? 7);
const ACTIVE = ['ACTIVE', 'GRACE_PERIOD', 'PAST_DUE'] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Calendar date in India (UTC+5:30). */
export function istDate(now = new Date()) {
  const d = new Date(now.getTime() + 330 * 60_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() };
}
const key = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
const shift = (y: number, m: number, by: number) => { const t = y * 12 + m + by; return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 }; };
const dateLabel = (y: number, m: number, day: number) => `${day} ${MONTHS[m].slice(0, 3)} ${y}`;

export type CycleStatus = 'MONTH_RUNNING' | 'WAITING_MARKETPLACE' | 'PREPARING' | 'READY';

@Injectable()
export class ReportCycleService implements OnModuleInit {
  private readonly log = new Logger('ReportCycle');
  constructor(
    private readonly db: PrismaService,
    private readonly orchestrator: OrchestratorService,
    private readonly dispatch: DispatcherService,
  ) {}

  onModuleInit() {
    if (process.env.REPORT_CYCLE === 'off') return;
    setTimeout(() => this.run().catch((e) => this.log.error(e)), 30_000).unref();
    setInterval(() => this.run().catch((e) => this.log.error(e)), 30 * 60_000).unref();
  }

  /** Opens last month's reporting request for every active client, once, on or after the marketplace report day. */
  async run(now = new Date()) {
    const today = istDate(now);
    if (today.day < MARKETPLACE_REPORT_DAY) return { period: null, opened: 0 };
    const prev = shift(today.y, today.m, -1);
    const period = key(prev.y, prev.m);
    const monthEnd = new Date(Date.UTC(today.y, today.m, 1) - 330 * 60_000); // 1st of this month, 00:00 IST
    const subs = await this.db.subscription.findMany({
      where: { status: { in: [...ACTIVE] }, OR: [{ currentPeriodStart: { lt: monthEnd } }, { currentPeriodStart: null, createdAt: { lt: monthEnd } }] },
      select: { organizationId: true }, distinct: ['organizationId'],
    });
    let opened = 0;
    for (const { organizationId } of subs) {
      const exists = await this.db.serviceRequest.findFirst({ where: { organizationId, featureKey: 'MONTHLY_PERFORMANCE_REPORT', details: { path: ['period'], equals: period } } });
      if (exists) continue;
      const name = `${MONTHS[prev.m]} ${prev.y}`;
      await this.orchestrator.systemIntake(organizationId, 'MONTHLY_PERFORMANCE_REPORT', `${name} report — Amazon & Flipkart monthly reports`, {
        period, source: 'monthly-cycle', note: `Use the ${name} reports Amazon and Flipkart published on the ${MARKETPLACE_REPORT_DAY}th; edit where needed, then publish by the ${REPORT_READY_DAY}th.`,
      });
      await this.dispatch.emit({ type: 'report.preparing', organizationId, title: `${name} report in progress`, body: `Amazon and Flipkart have published your ${name} reports. Your manager is preparing your report — ready by ${dateLabel(today.y, today.m, REPORT_READY_DAY)}.`, data: { period } });
      opened++;
    }
    if (opened) this.log.log(`Opened ${opened} report request(s) for ${period}`);
    return { period, opened };
  }

  /** Client view: this month and up to 3 closed months since the plan started, with where each report stands. */
  async schedule(orgId: string, now = new Date()) {
    const first = await this.db.subscription.findFirst({ where: { organizationId: orgId, status: { not: 'PENDING_PAYMENT' } }, orderBy: { createdAt: 'asc' }, select: { currentPeriodStart: true, createdAt: true } });
    if (!first) return [];
    const startIst = istDate(first.currentPeriodStart ?? first.createdAt);
    const today = istDate(now);
    const published = await this.db.monthlyReport.findMany({ where: { organizationId: orgId, status: 'PUBLISHED' }, select: { id: true, periodMonth: true, kind: true } });
    const rows = [];
    for (let i = 0; i <= 3; i++) {
      const p = shift(today.y, today.m, -i);
      if (p.y * 12 + p.m < startIst.y * 12 + startIst.m) break;
      const next = shift(p.y, p.m, 1);
      const period = key(p.y, p.m);
      const reports = published.filter((r) => r.periodMonth.toISOString().slice(0, 7) === period).map((r) => ({ id: r.id, kind: r.kind }));
      const afterMarketplaceDay = today.y * 12 + today.m > next.y * 12 + next.m || (today.y === next.y && today.m === next.m && today.day >= MARKETPLACE_REPORT_DAY);
      const status: CycleStatus = i === 0 ? 'MONTH_RUNNING' : reports.length ? 'READY' : afterMarketplaceDay ? 'PREPARING' : 'WAITING_MARKETPLACE';
      rows.push({
        period, label: `${MONTHS[p.m]} ${p.y}`, status, reports,
        marketplaceReportsOn: dateLabel(next.y, next.m, MARKETPLACE_REPORT_DAY),
        readyBy: dateLabel(next.y, next.m, REPORT_READY_DAY),
      });
    }
    return rows;
  }
}
