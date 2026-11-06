import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
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

const WELCOME_DELAY_MIN = Number(process.env.MANAGER_ASSIGN_DELAY_MIN ?? 5);
const WELCOME_GAP_SEC = Number(process.env.MANAGER_MESSAGE_GAP_SEC ?? 40);

/** Short, human hand-off messages, one per chat bubble. Plan benefits are on the dashboard, not repeated here. */
export function welcomeLines(kind: string, planCode: string, planName: string, managerName: string, clientName: string): string[] {
  const me = managerName.split(' ')[0];
  const you = clientName.split(' ')[0] || 'there';
  if (kind === 'CHANGE') {
    const next: Record<string, string> = {
      RESELLER: 'Your plan now covers listings, catalog and monthly reports. Tell me what you would like to focus on this month.',
      GROWTH: 'Ads, stock alerts and daily labels are now included. Shall I start with an ads plan for you?',
      PREMIUM: 'Strategy reviews, priority calls and thank-you note design are now included. When is a good time for a quick call?',
    };
    return [`Hi ${you}, saw you have moved to ${planName} 👍`, next[planCode] ?? 'Tell me what you would like to start with.'];
  }
  const last: Record<string, string> = {
    RESELLER: 'Also, which products should we list or map first?',
    GROWTH: 'Once that is in, I will put together an ads plan for you to approve.',
    PREMIUM: 'And when is a good time this week for a quick kick-off call?',
  };
  return [
    `Hi ${you}! I'm ${me} from SOLLUNA. I'll be your account manager 🙂`,
    `Your ${planName} plan is all set. To get started, could you add your Amazon / Flipkart seller details in Catalog?`,
    last[planCode] ?? 'Let me know what you would like to start with.',
  ];
}

@Injectable()
export class ChatService implements OnModuleInit {
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
    await this.processWelcomes(orgId).catch(() => undefined);
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
    const pending = await this.db.managerWelcome.findUnique({ where: { organizationId: orgId } });
    return {
      conversationId: conv.id, organizationId: orgId, managers: managers.map((m) => m.manager), messages: messages.reverse(),
      // Promise shown to the client while the hand-off is queued: a manager within 1 hour of the plan starting.
      managerPending: pending && pending.kind === 'NEW' && pending.step === 0 ? { assignBy: new Date(pending.createdAt.getTime() + 3_600_000) } : null,
    };
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
   * After a plan starts the client is told a manager will be assigned within 1 hour. The hand-off is queued
   * (ManagerWelcome) and processed after MANAGER_ASSIGN_DELAY_MIN: the least-loaded manager is assigned and sends a
   * few short chat messages, MANAGER_MESSAGE_GAP_SEC apart, like a person typing. Renewals send nothing; a plan
   * change gets a short note from the existing manager.
   */
  async welcomeOnActivation(orgId: string, info: ActivationInfo) {
    if (info.kind === 'renewal') return;
    const hasManager = await this.activeManagerId(orgId);
    const dueAt = new Date(Date.now() + WELCOME_DELAY_MIN * 60_000);
    const data = { planCode: info.planCode, previousPlanCode: info.previousPlanCode, kind: hasManager ? 'CHANGE' : 'NEW', preview: Boolean(info.preview), step: 0, dueAt };
    await this.db.managerWelcome.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...data }, update: { ...data, createdAt: new Date() } });
    if (!hasManager) {
      await this.dispatch.emit({ type: 'manager.pending', organizationId: orgId, title: 'Your manager is being assigned', body: `Your ${info.planName} plan is active. Your dedicated SOLLUNA manager will be assigned within 1 hour and will message you in Manager chat.` });
    }
    if (WELCOME_DELAY_MIN === 0) await this.processWelcomes(orgId);
  }

  private async activeManagerId(orgId: string) {
    const a = await this.db.managerAssignment.findFirst({ where: { organizationId: orgId, isPrimary: true, endedAt: null }, include: { manager: { select: { id: true, isActive: true } } } });
    return a?.manager.isActive ? a.manager.id : null;
  }

  /** Runs due hand-off steps. Called by a timer and whenever the client opens chat (so a sleeping server catches up). */
  async processWelcomes(orgId?: string) {
    for (let guard = 0; guard < 50; guard++) {
      const due = await this.db.managerWelcome.findFirst({ where: { dueAt: { lte: new Date() }, ...(orgId ? { organizationId: orgId } : {}) }, orderBy: { dueAt: 'asc' } });
      if (!due) return;
      // Claim the step so concurrent callers never send a message twice.
      const claimed = await this.db.managerWelcome.updateMany({ where: { id: due.id, step: due.step, dueAt: due.dueAt }, data: { dueAt: new Date(Date.now() + 10 * 60_000) } });
      if (!claimed.count) continue;
      try { await this.runWelcomeStep(due); }
      catch (e) { Logger.error(`Manager welcome failed for ${due.organizationId}: ${(e as Error).message}`, 'ManagerWelcome'); return; }
    }
  }

  private async runWelcomeStep(w: { id: string; organizationId: string; planCode: string; previousPlanCode: string | null; kind: string; preview: boolean; step: number }) {
    const orgId = w.organizationId;
    let managerId = await this.activeManagerId(orgId);
    if (w.step === 0 && !managerId) {
      await this.db.managerAssignment.updateMany({ where: { organizationId: orgId, isPrimary: true, endedAt: null }, data: { endedAt: new Date() } });
      managerId = await this.autoAssign(orgId);
      if (!managerId) {
        await this.dispatch.notifyStaff({ roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER'], organizationId: orgId, type: 'admin.manager_needed', title: 'Assign a manager now', body: 'A client started a plan and was promised a manager within 1 hour, but no active manager is available.' });
        return; // retried when the claim expires (10 minutes)
      }
      const org = await this.db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { legalName: true, brandName: true } });
      const plan = await this.db.plan.findUnique({ where: { code: w.planCode }, select: { name: true } });
      await this.db.notification.create({ data: { organizationId: orgId, userId: managerId, type: 'manager.new_client', title: `New client: ${org.brandName ?? org.legalName}`, body: `${plan?.name ?? w.planCode} plan${w.preview ? ' (preview test)' : ''}. You have been assigned as their manager — a short hello has been sent; follow up on onboarding.` } });
    }
    if (!managerId) { await this.db.managerWelcome.delete({ where: { id: w.id } }); return; }
    const [manager, client, plan] = await Promise.all([
      this.db.user.findUniqueOrThrow({ where: { id: managerId }, select: { id: true, name: true } }),
      this.db.user.findFirst({ where: { organizationId: orgId, type: 'CUSTOMER', isActive: true }, orderBy: { createdAt: 'asc' }, select: { name: true } }),
      this.db.plan.findUnique({ where: { code: w.planCode }, select: { name: true } }),
    ]);
    const lines = welcomeLines(w.kind, w.planCode, plan?.name ?? w.planCode, manager.name, client?.name ?? '');
    const body = lines[w.step];
    if (body) {
      const conv = await this.conversation(orgId);
      const message = await this.db.$transaction(async (tx) => {
        const m = await tx.message.create({ data: { conversationId: conv.id, senderId: manager.id, senderType: 'STAFF', body } });
        await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: m.createdAt } });
        return tx.message.findUniqueOrThrow({ where: { id: m.id }, select: MESSAGE_SELECT });
      });
      this.events.next({ type: 'message', organizationId: orgId, internal: false, message: message as ChatMessage });
      if (w.step === 0) {
        await this.dispatch.emit({ type: 'chat.message', organizationId: orgId, title: w.kind === 'NEW' ? `${manager.name} is your SOLLUNA manager` : `Message from ${manager.name}`, body, data: { messageId: message.id } });
        await this.audit.log({ action: 'manager.welcome', entity: 'Organization', entityId: orgId, organizationId: orgId, after: { managerId: manager.id, plan: w.planCode, kind: w.kind } });
      }
    }
    if (w.step + 1 < lines.length) {
      await this.db.managerWelcome.update({ where: { id: w.id }, data: { step: w.step + 1, dueAt: new Date(Date.now() + WELCOME_GAP_SEC * 1000 * (1 + (w.step % 2) * 0.5)) } });
    } else {
      await this.db.managerWelcome.delete({ where: { id: w.id } });
    }
  }

  onModuleInit() {
    setInterval(() => this.processWelcomes().catch(() => undefined), 20_000).unref();
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
