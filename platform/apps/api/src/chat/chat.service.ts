import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Subject } from 'rxjs';
import { z } from 'zod';
import { FEATURES } from '../../../../packages/permissions/src/features';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { parse } from '../common/zod';
import { DispatcherService } from '../connectors/dispatcher.service';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import type { AuthUser } from '../auth/auth.types';
import { BillingService, type ActivationInfo } from '../billing/billing.service';

/** Live events. Customers only ever receive their own org's non-internal events (filtered at the stream). */
export type ChatEvent =
  | { type: 'message'; organizationId: string; internal: boolean; message: ChatMessage }
  | { type: 'read'; organizationId: string; by: 'CUSTOMER' | 'STAFF'; at: string };

export interface ChatMessage {
  id: string; body: string; createdAt: Date; readAt: Date | null; isInternalNote: boolean; senderType: 'CUSTOMER' | 'STAFF';
  sender: { id: string; name: string };
  attachments: { id: string; title: string; fileName: string; mimeType: string; sizeBytes: number }[];
}

const SendSchema = z.object({
  body: z.string().trim().max(5000).default(''),
  documentIds: z.array(z.string()).max(5).default([]),
  internal: z.boolean().default(false),
});

const MESSAGE_SELECT = {
  id: true, body: true, createdAt: true, readAt: true, isInternalNote: true, senderType: true,
  sender: { select: { id: true, name: true } },
  attachments: { where: { deletedAt: null }, select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true } },
} as const;

/** First-response targets from the manager-chat-support skill §10 (shown in the staff inbox). */
export const ACK_TARGET_MINUTES = { P1: 30, P2: 120, P3: 24 * 60, P4: 48 * 60 } as const;

/**
 * Manager Chat Support (skill: manager-chat-support).
 * One private conversation per client organization; staff internal notes never reach the client;
 * new client messages notify the assigned manager(s); staff replies notify the client in-app and via
 * the connector webhook (Zapier → Gmail from solluna.play@gmail.com).
 */
@Injectable()
export class ChatService {
  readonly events = new Subject<ChatEvent>();

  constructor(
    private readonly db: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly dispatch: DispatcherService,
    private readonly orch: OrchestratorService,
    billing: BillingService,
  ) {
    // The manager is assigned when a plan starts (not at sign-up) and welcomes the client for that plan.
    billing.activationListeners.push((orgId, info) => this.welcomeOnActivation(orgId, info));
  }

  private async conversation(orgId: string) {
    return (await this.db.conversation.findUnique({ where: { organizationId: orgId } }))
      ?? this.db.conversation.create({ data: { organizationId: orgId } });
  }

  async history(user: AuthUser, orgId: string, opts: { q?: string; before?: string; limit?: number } = {}) {
    await this.access.assertOrg(user, orgId);
    const conv = await this.conversation(orgId);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const messages = await this.db.message.findMany({
      where: {
        conversationId: conv.id,
        ...(user.type === 'CUSTOMER' ? { isInternalNote: false } : {}),
        ...(opts.q ? { body: { contains: opts.q, mode: 'insensitive' as const } } : {}),
        ...(opts.before ? { createdAt: { lt: new Date(opts.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: MESSAGE_SELECT,
    });
    const managers = await this.db.managerAssignment.findMany({ where: { organizationId: orgId, endedAt: null }, include: { manager: { select: { id: true, name: true, staffRole: true } } } });
    return { conversationId: conv.id, organizationId: orgId, managers: managers.map((m) => m.manager), messages: messages.reverse() };
  }

  async send(user: AuthUser, orgId: string, input: unknown) {
    const d = parse(SendSchema, input);
    await this.access.assertOrg(user, orgId);
    if (!d.body && !d.documentIds.length) throw new BadRequestException('Write a message or attach a file');
    if (d.internal && user.type !== 'STAFF') throw new BadRequestException('Internal notes are for SOLLUNA staff only');
    const conv = await this.conversation(orgId);

    // Attachments must be this org's documents, uploaded by this user, not yet attached elsewhere.
    const docs = d.documentIds.length
      ? await this.db.document.findMany({ where: { id: { in: d.documentIds }, organizationId: orgId, uploadedById: user.id, messageId: null, deletedAt: null } })
      : [];
    if (docs.length !== d.documentIds.length) throw new BadRequestException('One or more attachments are invalid');
    if (!d.internal && docs.some((x) => x.visibility === 'INTERNAL')) throw new BadRequestException('Internal documents can only be attached to internal notes');

    const message = await this.db.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: { conversationId: conv.id, senderId: user.id, senderType: user.type, body: d.body, isInternalNote: d.internal },
      });
      if (docs.length) await tx.document.updateMany({ where: { id: { in: docs.map((x) => x.id) } }, data: { messageId: m.id, kind: 'CHAT_ATTACHMENT' } });
      await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: m.createdAt } });
      return tx.message.findUniqueOrThrow({ where: { id: m.id }, select: MESSAGE_SELECT });
    });

    this.events.next({ type: 'message', organizationId: orgId, internal: d.internal, message: message as ChatMessage });
    await this.notify(user, orgId, message as ChatMessage);
    return message;
  }

  private async notify(user: AuthUser, orgId: string, m: ChatMessage) {
    if (m.isInternalNote) return;
    const preview = m.body ? (m.body.length > 160 ? `${m.body.slice(0, 157)}…` : m.body) : `${m.attachments.length} attachment(s)`;
    if (user.type === 'CUSTOMER') {
      const org = await this.db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { legalName: true, brandName: true } });
      const managers = await this.db.managerAssignment.findMany({ where: { organizationId: orgId, endedAt: null }, select: { managerId: true } });
      if (managers.length) {
        await this.db.notification.createMany({
          data: managers.map((x) => ({ organizationId: orgId, userId: x.managerId, type: 'chat.client_message', title: `New message from ${org.brandName ?? org.legalName}`, body: preview })),
        });
      }
    } else {
      await this.dispatch.emit({ type: 'chat.message', organizationId: orgId, title: `New message from your SOLLUNA manager ${m.sender.name}`, body: preview, data: { messageId: m.id } });
    }
  }

  /** Marks the other side's messages as read and tells live viewers. */
  async markRead(user: AuthUser, orgId: string) {
    await this.access.assertOrg(user, orgId);
    const conv = await this.conversation(orgId);
    const at = new Date();
    const r = await this.db.message.updateMany({
      where: { conversationId: conv.id, readAt: null, isInternalNote: false, senderType: user.type === 'CUSTOMER' ? 'STAFF' : 'CUSTOMER' },
      data: { readAt: at },
    });
    if (r.count) this.events.next({ type: 'read', organizationId: orgId, by: user.type, at: at.toISOString() });
    return { marked: r.count };
  }

  /** Staff inbox: accessible conversations with unanswered client messages first. */
  async inbox(user: AuthUser) {
    const orgIds = await this.access.staffOrgIds(user);
    const convs = await this.db.conversation.findMany({
      where: orgIds ? { organizationId: { in: orgIds } } : {},
      include: { organization: { select: { id: true, legalName: true, brandName: true, managerAssignments: { where: { endedAt: null }, include: { manager: { select: { id: true, name: true } } } } } } },
    });
    const rows = await Promise.all(convs.map(async (c) => {
      const [unread, oldestUnread, last] = await Promise.all([
        this.db.message.count({ where: { conversationId: c.id, senderType: 'CUSTOMER', readAt: null } }),
        this.db.message.findFirst({ where: { conversationId: c.id, senderType: 'CUSTOMER', readAt: null }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        this.db.message.findFirst({ where: { conversationId: c.id, isInternalNote: false }, orderBy: { createdAt: 'desc' }, select: { body: true, senderType: true, createdAt: true } }),
      ]);
      const waitingMinutes = oldestUnread ? Math.floor((Date.now() - oldestUnread.createdAt.getTime()) / 60_000) : 0;
      return {
        organizationId: c.organizationId, name: c.organization.brandName ?? c.organization.legalName,
        managers: c.organization.managerAssignments.map((a) => a.manager),
        unread, waitingSince: oldestUnread?.createdAt ?? null, waitingMinutes,
        // Default P3 target until a message is triaged into a request with its own priority.
        overdue: Boolean(oldestUnread) && waitingMinutes > ACK_TARGET_MINUTES.P3,
        last,
      };
    }));
    return rows.sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || +(b.last?.createdAt ?? 0) - +(a.last?.createdAt ?? 0));
  }

  /** manager-chat-support §11: route a chat request to the orchestrator (entitlements apply as usual). */
  async createRequest(user: AuthUser, orgId: string, input: unknown) {
    await this.access.assertOrg(user, orgId);
    const actingFor: AuthUser = { ...user, organizationId: orgId };
    const result = await this.orch.intake(actingFor, input);
    const label = FEATURES[result.request.featureKey as keyof typeof FEATURES].label;
    await this.send(user, orgId, { body: `I've logged this as a request: "${result.request.title}" (${label}). Status: ${result.update.sections.status}.`, internal: false });
    return result;
  }

  async assignManager(actor: AuthUser, orgId: string, input: unknown) {
    const { managerId } = parse(z.object({ managerId: z.string() }), input);
    const manager = await this.db.user.findUnique({ where: { id: managerId } });
    if (!manager || manager.type !== 'STAFF' || !manager.isActive) throw new BadRequestException('Manager must be an active SOLLUNA staff member');
    if (!(await this.db.organization.findUnique({ where: { id: orgId } }))) throw new NotFoundException('Client not found');
    await this.db.$transaction(async (tx) => {
      await tx.managerAssignment.updateMany({ where: { organizationId: orgId, isPrimary: true, endedAt: null }, data: { endedAt: new Date() } });
      await tx.managerAssignment.create({ data: { organizationId: orgId, managerId, isPrimary: true } });
      await this.audit.log({ actor, action: 'manager.assign', entity: 'Organization', entityId: orgId, after: { managerId } }, tx);
    });
    return { organizationId: orgId, managerId };
  }

  /** Onboarding step 7: assign the least-loaded active manager (Operations Manager or Support Executive). */
  async autoAssign(orgId: string) {
    const candidates = await this.db.user.findMany({
      where: { type: 'STAFF', isActive: true, staffRole: { in: ['OPERATIONS_MANAGER', 'SUPPORT_EXECUTIVE'] } },
      select: { id: true, _count: { select: { managedAssignments: { where: { endedAt: null } } } } },
    });
    if (!candidates.length) return null;
    const pick = candidates.sort((a, b) => a._count.managedAssignments - b._count.managedAssignments || a.id.localeCompare(b.id))[0];
    await this.db.managerAssignment.create({ data: { organizationId: orgId, managerId: pick.id, isPrimary: true } });
    await this.audit.log({ action: 'manager.auto_assign', entity: 'Organization', entityId: orgId, organizationId: orgId, after: { managerId: pick.id } });
    return pick.id;
  }

  /**
   * After a plan starts: make sure the client has an active primary manager (least-loaded, see autoAssign), then
   * post the manager's welcome for that plan into Manager Chat. Renewals send nothing; a plan change lists what is
   * newly included. Without any available manager, admins are alerted and the client is told one is being assigned.
   */
  async welcomeOnActivation(orgId: string, info: ActivationInfo) {
    if (info.kind === 'renewal') return null;
    const current = await this.db.managerAssignment.findFirst({ where: { organizationId: orgId, isPrimary: true, endedAt: null }, include: { manager: { select: { id: true, isActive: true } } } });
    let managerId = current?.manager.isActive ? current.manager.id : null;
    if (!managerId) {
      if (current) await this.db.managerAssignment.update({ where: { id: current.id }, data: { endedAt: new Date() } });
      managerId = await this.autoAssign(orgId);
    }
    if (!managerId) {
      await this.dispatch.notifyStaff({ roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER'], organizationId: orgId, type: 'admin.manager_needed', title: 'Assign a manager', body: `A client started the ${info.planName} plan but no active manager is available. Assign one in Client workspace.` });
      await this.dispatch.emit({ type: 'manager.pending', organizationId: orgId, title: 'Your manager is being assigned', body: 'Your dedicated SOLLUNA manager will message you here shortly.' });
      return null;
    }
    const [manager, client, org] = await Promise.all([
      this.db.user.findUniqueOrThrow({ where: { id: managerId }, select: { id: true, name: true } }),
      this.db.user.findFirst({ where: { organizationId: orgId, type: 'CUSTOMER', isActive: true }, orderBy: { createdAt: 'asc' }, select: { name: true } }),
      this.db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { legalName: true, brandName: true } }),
    ]);
    const body = await this.welcomeText(info, manager.name, client?.name ?? '');
    const conv = await this.conversation(orgId);
    const message = await this.db.$transaction(async (tx) => {
      const m = await tx.message.create({ data: { conversationId: conv.id, senderId: manager.id, senderType: 'STAFF', body } });
      await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: m.createdAt } });
      return tx.message.findUniqueOrThrow({ where: { id: m.id }, select: MESSAGE_SELECT });
    });
    this.events.next({ type: 'message', organizationId: orgId, internal: false, message: message as ChatMessage });
    await this.dispatch.emit({ type: 'chat.message', organizationId: orgId, title: `${manager.name} is your SOLLUNA manager`, body: `Your ${info.planName} plan is active. ${manager.name.split(' ')[0]} has sent you a welcome message in Manager Chat.`, data: { messageId: message.id } });
    await this.db.notification.create({ data: { organizationId: orgId, userId: manager.id, type: 'manager.new_client', title: `${info.kind === 'change' ? 'Plan changed' : 'New client'}: ${org.brandName ?? org.legalName}`, body: `${info.planName} plan${info.preview ? ' (preview test)' : ''}. Your welcome message has been sent — follow up on onboarding.` } });
    await this.audit.log({ action: 'manager.welcome', entity: 'Organization', entityId: orgId, organizationId: orgId, after: { managerId: manager.id, plan: info.planCode, kind: info.kind } });
    return message;
  }

  private async welcomeText(info: ActivationInfo, managerName: string, clientName: string) {
    const enabled = async (code: string | null) => {
      if (!code) return new Map<string, { limit: number | null; mode?: string }>();
      const plan = await this.db.plan.findUnique({ where: { code }, include: { features: { where: { enabled: true } } } });
      return new Map((plan?.features ?? []).map((f) => [f.featureKey, { limit: f.limitValue, mode: (f.meta as { mode?: string } | null)?.mode }]));
    };
    const now = await enabled(info.planCode);
    const before = info.kind === 'change' ? await enabled(info.previousPlanCode) : new Map();
    const label = (k: string) => (FEATURES as Record<string, { label: string }>)[k]?.label.replace(' / Month', '') ?? k;
    const first = clientName.split(' ')[0] || 'there';
    const listings = (k: string) => { const f = now.get(k); return f ? (f.limit == null ? 'unlimited' : `${f.limit} per month`) : null; };
    const call = now.get('CALL_SUPPORT')?.mode;

    const sections: [string, string[]][] = [
      ['Account & catalog', ['SELLER_ACCOUNT_REGISTRATION', 'BRAND_APPROVAL', 'CATALOG_MAPPING', 'SEO_KEYWORD_OPTIMIZATION']],
      ['Reports & support', ['MONTHLY_PERFORMANCE_REPORT', 'MONTHLY_PL_REPORT', 'CA_DOCUMENTATION', 'MARKETPLACE_SUPPORT']],
      ['Growth', ['ADS_MANAGEMENT', 'PROMOTIONAL_MANAGEMENT', 'LOW_STOCK_ALERTS', 'COMPETITOR_PRICE_MONITORING', 'LISTING_HEALTH_MONITORING', 'INVENTORY_REPLENISHMENT']],
      ['Shipping & branding', ['SHIPPING_LABEL_GENERATION', 'DAILY_LABEL_PROCESSING', 'PERSONALIZED_THANK_YOU_NOTES', 'CUSTOM_THANK_YOU_DESIGN']],
      ['Strategy', ['PRODUCT_RESEARCH', 'BUSINESS_GROWTH_SUGGESTIONS', 'COMPETITOR_STRATEGY', 'BUSINESS_EXPANSION', 'PROFITABILITY_PRICING', 'NEW_PRODUCT_LAUNCH']],
    ];
    const lines: string[] = [];
    const amz = listings('NEW_LISTING_AMAZON'), fk = listings('NEW_LISTING_FLIPKART');
    if (info.kind === 'change') {
      const added = [...now.keys()].filter((k) => !before.has(k));
      lines.push(`Namaste ${first}! Your plan is now ${info.planName}.`, '');
      if (added.length) lines.push('Newly included for you:', ...added.map((k) => `• ${label(k)}`));
      if (amz || fk) lines.push(`• New listings: Amazon ${amz ?? '—'}, Flipkart ${fk ?? '—'}`);
      lines.push('', 'Tell me what you would like to start with and I will plan it for this month.');
    } else {
      lines.push(
        `Namaste ${first}, welcome to SOLLUNA! 🙏`, '',
        `I'm ${managerName}, your dedicated account manager. Your ${info.planName} plan is active, and I will personally coordinate your Amazon and Flipkart work from here.`, '',
        `What your ${info.planName} plan covers:`,
      );
      if (amz || fk) lines.push(`• New listings: Amazon ${amz ?? '—'}, Flipkart ${fk ?? '—'}`);
      for (const [title, keys] of sections) {
        const inc = keys.filter((k) => now.has(k)).map(label);
        if (inc.length) lines.push(`• ${title}: ${inc.join(', ')}`);
      }
      lines.push(`• Manager Chat Support${call ? ` + call support (${call === 'PRIORITY' ? 'priority' : 'on request'})` : ''}`);
      lines.push('', "Let's get you started (about 10 minutes):",
        '1. Catalog → add your Amazon and Flipkart seller details. We never ask for passwords or OTPs.',
        '2. Documents → upload your GST certificate and any brand documents.',
        '3. Reply here with the first products you want us to list or map.');
      if (info.planCode === 'PREMIUM') lines.push('', 'As a Premium client you also get priority calls, custom thank-you note design and monthly strategy reviews. Share a good time this week for a 20-minute kick-off call.');
      else if (info.planCode === 'GROWTH') lines.push('', 'Once your catalog is in, I will share an ads plan for your approval and switch on low-stock alerts and daily label processing.');
      else lines.push('', 'Need ads, shipping labels or stock alerts later? You can move to Growth any time from Billing.');
      lines.push('', `Message me here any time — I reply during business hours (Mon–Sat, 10 AM–7 PM IST).`, `— ${managerName}`);
    }
    return lines.join('\n');
  }

  async clients() {
    const orgs = await this.db.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        managerAssignments: { where: { endedAt: null }, include: { manager: { select: { id: true, name: true, staffRole: true } } } },
        subscriptions: { where: { status: { in: ['ACTIVE', 'GRACE_PERIOD'] } }, include: { plan: { select: { name: true } } } },
      },
    });
    return orgs.map((o) => ({ id: o.id, name: o.brandName ?? o.legalName, legalName: o.legalName, plan: o.subscriptions[0]?.plan.name ?? null, managers: o.managerAssignments.map((a) => a.manager) }));
  }

  staff() {
    return this.db.user.findMany({ where: { type: 'STAFF', isActive: true }, select: { id: true, name: true, email: true, staffRole: true }, orderBy: { name: 'asc' } });
  }
}
