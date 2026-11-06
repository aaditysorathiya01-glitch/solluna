import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { FEATURES, FEATURE_KEYS, type FeatureKey } from '../../../../packages/permissions/src/features';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/zod';
import { DispatcherService } from '../connectors/dispatcher.service';
import { CatalogService } from '../catalog/catalog.service';
import type { AuthUser } from '../auth/auth.types';

const OPEN_TASK: Prisma.EnumTaskStatusFilter<'Task'> = { notIn: ['COMPLETED', 'CANCELLED', 'PARTIALLY_COMPLETED'] };
const OPEN_TICKET = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'WAITING_FOR_MARKETPLACE'] as const;

@Injectable()
export class AdminService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService, private readonly dispatch: DispatcherService, private readonly catalog: CatalogService) {}

  async overview() {
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const [clients, active, grace, pastDue, openTickets, overdueP1, openTasks, blockedTasks, failed30, verified30, newInquiries, staff] = await Promise.all([
      this.db.organization.count(),
      this.db.subscription.findMany({ where: { status: 'ACTIVE' }, include: { plan: true } }),
      this.db.subscription.count({ where: { status: 'GRACE_PERIOD' } }),
      this.db.subscription.count({ where: { status: 'PAST_DUE' } }),
      this.db.supportTicket.count({ where: { status: { in: [...OPEN_TICKET] } } }),
      this.db.supportTicket.count({ where: { status: { in: [...OPEN_TICKET] }, priority: 'P1', firstResponseAt: null, createdAt: { lt: new Date(Date.now() - 30 * 60_000) } } }),
      this.db.task.count({ where: { status: OPEN_TASK } }),
      this.db.task.count({ where: { status: 'BLOCKED' } }),
      this.db.payment.count({ where: { status: 'FAILED', createdAt: { gte: since30 } } }),
      this.db.payment.aggregate({ where: { status: 'VERIFIED', verifiedAt: { gte: since30 } }, _sum: { taxablePaise: true, amountPaise: true }, _count: true }),
      this.db.contactInquiry.count({ where: { status: 'NEW' } }),
      this.db.user.count({ where: { type: 'STAFF', isActive: true } }),
    ]);
    const byPlan: Record<string, number> = {};
    for (const s of active) byPlan[s.plan.name] = (byPlan[s.plan.name] ?? 0) + 1;
    return {
      clients, activeSubscriptions: active.length, byPlan, grace, pastDue,
      mrrPaise: active.reduce((n, s) => n + s.plan.pricePaise, 0), // GST-exclusive monthly recurring revenue
      revenue30: { taxablePaise: verified30._sum.taxablePaise ?? 0, collectedPaise: verified30._sum.amountPaise ?? 0, payments: verified30._count },
      failedPayments30: failed30, openTickets, overdueP1, openTasks, blockedTasks, newInquiries, staff,
    };
  }

  // ───────── Clients ─────────

  async clients() {
    const orgs = await this.db.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        managerAssignments: { where: { endedAt: null }, include: { manager: { select: { id: true, name: true, staffRole: true } } } },
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, include: { plan: { select: { name: true, code: true } } } },
        _count: { select: { supportTickets: { where: { status: { in: [...OPEN_TICKET] } } }, tasks: { where: { status: OPEN_TASK } } } },
      },
    });
    return orgs.map((o) => ({
      id: o.id, name: o.brandName ?? o.legalName, legalName: o.legalName, gstin: o.gstin, contactEmail: o.contactEmail, contactPhone: o.contactPhone,
      isSuspended: o.isSuspended, suspendedReason: o.suspendedReason, onboardedAt: o.onboardedAt, createdAt: o.createdAt,
      plan: o.subscriptions[0] ? { name: o.subscriptions[0].plan.name, code: o.subscriptions[0].plan.code, status: o.subscriptions[0].status, currentPeriodEnd: o.subscriptions[0].currentPeriodEnd, cancelAtPeriodEnd: o.subscriptions[0].cancelAtPeriodEnd } : null,
      managers: o.managerAssignments.map((a) => a.manager), openTickets: o._count.supportTickets, openTasks: o._count.tasks,
    }));
  }

  async client(actor: AuthUser, orgId: string) {
    const org = await this.db.organization.findUnique({
      where: { id: orgId },
      include: {
        users: { select: { id: true, name: true, email: true, phone: true, isActive: true, emailVerified: true, lastLoginAt: true } },
        subscriptions: { orderBy: { createdAt: 'desc' }, include: { plan: { select: { name: true, code: true, pricePaise: true } } } },
        payments: { orderBy: { createdAt: 'desc' }, take: 20 },
        invoices: { orderBy: { issuedAt: 'desc' }, take: 20, select: { id: true, number: true, amountPaise: true, issuedAt: true } },
        managerAssignments: { where: { endedAt: null }, include: { manager: { select: { id: true, name: true } } } },
      },
    });
    if (!org) throw new NotFoundException('Client not found');
    const [onboarding, marketplaces, usage] = await Promise.all([
      this.catalog.onboarding(actor, orgId),
      this.catalog.marketplaces(actor, orgId),
      this.db.usageCounter.findMany({ where: { organizationId: orgId }, orderBy: { periodStart: 'desc' }, take: 6 }),
    ]);
    return { ...org, onboarding, marketplaces, usage };
  }

  async suspend(actor: AuthUser, orgId: string, input: unknown) {
    const d = parse(z.object({ suspended: z.boolean(), reason: z.string().trim().max(500).optional() }), input);
    if (d.suspended && (!d.reason || d.reason.length < 5)) throw new BadRequestException('Give a reason for the suspension (it is recorded in the audit log)');
    const before = await this.db.organization.findUnique({ where: { id: orgId } });
    if (!before) throw new NotFoundException('Client not found');
    const org = await this.db.organization.update({ where: { id: orgId }, data: { isSuspended: d.suspended, suspendedReason: d.suspended ? d.reason : null } });
    await this.audit.log({ actor, action: d.suspended ? 'organization.suspend' : 'organization.reactivate', entity: 'Organization', entityId: orgId, organizationId: orgId, before: { isSuspended: before.isSuspended }, after: d });
    // Client users lose access on their next request (AuthGuard re-checks suspension every request).
    await this.dispatch.emit({ type: 'account.suspended', organizationId: orgId, title: d.suspended ? 'Account access paused' : 'Account access restored', body: d.suspended ? `Your SOLLUNA account has been paused: ${d.reason}. Contact solluna.play@gmail.com.` : 'Your SOLLUNA account is active again.' });
    return { id: org.id, isSuspended: org.isSuspended };
  }

  // ───────── Team ─────────

  async team() {
    const staff = await this.db.user.findMany({
      where: { type: 'STAFF' },
      select: { id: true, name: true, email: true, staffRole: true, isActive: true, twoFactorEnabledAt: true, lastLoginAt: true, createdAt: true, _count: { select: { managedAssignments: { where: { endedAt: null } } } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    const tasks = await this.db.task.groupBy({ by: ['assigneeId'], where: { status: OPEN_TASK, assigneeId: { not: null } }, _count: true });
    const tickets = await this.db.supportTicket.groupBy({ by: ['assigneeId'], where: { status: { in: [...OPEN_TICKET] }, assigneeId: { not: null } }, _count: true });
    return staff.map((s) => ({
      ...s, twoFactorEnabled: Boolean(s.twoFactorEnabledAt), clients: s._count.managedAssignments,
      openTasks: tasks.find((t) => t.assigneeId === s.id)?._count ?? 0, openTickets: tickets.find((t) => t.assigneeId === s.id)?._count ?? 0,
    }));
  }

  // ───────── Plans (admin-editable limits; plan matrix seeds defaults) ─────────

  async plans() {
    const plans = await this.db.plan.findMany({ orderBy: { sortOrder: 'asc' }, include: { features: true, _count: { select: { subscriptions: { where: { status: 'ACTIVE' } } } } } });
    return plans.map((p) => ({
      id: p.id, code: p.code, name: p.name, pricePaise: p.pricePaise, isActive: p.isActive, activeSubscriptions: p._count.subscriptions,
      features: FEATURE_KEYS.map((k) => {
        const f = p.features.find((x) => x.featureKey === k);
        return { key: k, label: FEATURES[k].label, section: FEATURES[k].section, enabled: f?.enabled ?? false, limitValue: f?.limitValue ?? null, metered: Boolean((FEATURES[k] as { metered?: boolean }).metered), meta: f?.meta ?? null };
      }),
    }));
  }

  async updatePlan(actor: AuthUser, code: string, input: unknown) {
    const d = parse(z.object({ pricePaise: z.number().int().min(100).max(100_000_00).optional(), isActive: z.boolean().optional() }), input);
    const before = await this.db.plan.findUnique({ where: { code } });
    if (!before) throw new NotFoundException('Plan not found');
    const p = await this.db.plan.update({ where: { code }, data: d });
    // Existing subscribers keep paying the price of their current period; new checkouts and renewals use the new price.
    await this.audit.log({ actor, action: 'plan.update', entity: 'Plan', entityId: p.id, before: { pricePaise: before.pricePaise, isActive: before.isActive }, after: d });
    return p;
  }

  async updatePlanFeature(actor: AuthUser, code: string, key: string, input: unknown) {
    if (!FEATURE_KEYS.includes(key as FeatureKey)) throw new NotFoundException('Unknown feature');
    const d = parse(z.object({ enabled: z.boolean(), limitValue: z.number().int().min(0).max(100_000).nullable().optional() }), input);
    const plan = await this.db.plan.findUnique({ where: { code } });
    if (!plan) throw new NotFoundException('Plan not found');
    const metered = Boolean((FEATURES[key as FeatureKey] as { metered?: boolean }).metered);
    if (!metered && d.limitValue != null) throw new BadRequestException('Only metered features (new listings) take a numeric limit');
    const before = await this.db.planFeature.findUnique({ where: { planId_featureKey: { planId: plan.id, featureKey: key } } });
    const row = await this.db.planFeature.upsert({
      where: { planId_featureKey: { planId: plan.id, featureKey: key } },
      create: { planId: plan.id, featureKey: key, enabled: d.enabled, limitValue: metered ? d.limitValue ?? null : null },
      update: { enabled: d.enabled, ...(metered && d.limitValue !== undefined ? { limitValue: d.limitValue } : {}) },
    });
    await this.audit.log({ actor, action: 'plan.feature_update', entity: 'PlanFeature', entityId: row.id, before: before && { enabled: before.enabled, limitValue: before.limitValue }, after: { plan: code, key, enabled: row.enabled, limitValue: row.limitValue } });
    return row;
  }

  // ───────── Payments ─────────

  async payments(status?: string) {
    const rows = await this.db.payment.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: 'desc' }, take: 200,
      include: { organization: { select: { legalName: true, brandName: true } } },
    });
    const invoices = await this.db.invoice.findMany({ where: { paymentId: { in: rows.map((r) => r.id) } }, select: { id: true, paymentId: true, number: true } });
    return rows.map((r) => ({ ...r, invoice: invoices.find((i) => i.paymentId === r.id) ?? null }));
  }

  // ───────── Audit log ─────────

  async auditLog(q: { organizationId?: string; action?: string; actorId?: string; before?: string }) {
    return this.db.auditLog.findMany({
      where: {
        ...(q.organizationId ? { organizationId: q.organizationId } : {}),
        ...(q.action ? { action: { startsWith: q.action } } : {}),
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' }, take: 100,
      include: { actor: { select: { name: true, email: true, staffRole: true } } },
    });
  }

  // ───────── Contact inquiries ─────────

  async createInquiry(input: unknown, ip?: string) {
    const d = parse(z.object({
      name: z.string().trim().min(2).max(100),
      email: z.string().trim().toLowerCase().email(),
      phone: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid Indian mobile number').optional().or(z.literal('').transform(() => undefined)),
      business: z.string().trim().max(200).optional(),
      topic: z.enum(['GENERAL', 'PLANS', 'SUPPORT', 'PARTNERSHIP']).default('GENERAL'),
      message: z.string().trim().min(10).max(3000),
      website: z.string().max(0).optional(), // honeypot: real users never fill this
    }), input);
    const q = await this.db.contactInquiry.create({ data: { name: d.name, email: d.email, phone: d.phone, business: d.business, topic: d.topic, message: d.message, ip } });
    await this.dispatch.notifyStaff({ roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER'], type: 'admin.inquiry', title: `New enquiry: ${d.name}${d.business ? ` (${d.business})` : ''}`, body: `${d.topic.toLowerCase()} · ${d.email}${d.phone ? ` · ${d.phone}` : ''}\n${d.message.slice(0, 300)}` });
    return { ok: true, id: q.id };
  }

  inquiries(status?: string) {
    return this.db.contactInquiry.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async updateInquiry(actor: AuthUser, id: string, input: unknown) {
    const { status } = parse(z.object({ status: z.enum(['NEW', 'CONTACTED', 'CONVERTED', 'CLOSED']) }), input);
    const q = await this.db.contactInquiry.update({ where: { id }, data: { status, handledById: actor.id } }).catch(() => { throw new NotFoundException('Enquiry not found'); });
    await this.audit.log({ actor, action: 'inquiry.update', entity: 'ContactInquiry', entityId: id, after: { status } });
    return q;
  }

  // ───────── Announcements ─────────

  async announce(actor: AuthUser, input: unknown) {
    const d = parse(z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(5).max(2000), audience: z.enum(['ALL_ACTIVE', 'RESELLER', 'GROWTH', 'PREMIUM']) }), input);
    const subs = await this.db.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'GRACE_PERIOD'] }, ...(d.audience !== 'ALL_ACTIVE' ? { plan: { code: d.audience } } : {}) },
      select: { organizationId: true }, distinct: ['organizationId'],
    });
    for (const s of subs) await this.dispatch.emit({ type: 'announcement', organizationId: s.organizationId, title: d.title, body: d.body });
    await this.audit.log({ actor, action: 'announcement.send', entity: 'Notification', after: { ...d, recipients: subs.length } as Prisma.InputJsonValue });
    return { recipients: subs.length };
  }
}
