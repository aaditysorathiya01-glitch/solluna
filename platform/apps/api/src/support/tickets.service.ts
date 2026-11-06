import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { parse } from '../common/zod';
import { DispatcherService } from '../connectors/dispatcher.service';
import type { AuthUser } from '../auth/auth.types';

const CATEGORIES = ['ACCOUNT_REGISTRATION', 'BRAND_APPROVAL', 'CATALOG_MAPPING', 'NEW_LISTING', 'ADS', 'PROMOTIONS', 'INVENTORY', 'SHIPPING_LABELS', 'PAYMENTS_SETTLEMENTS', 'ACCOUNT_HEALTH'] as const;
const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: 'New', ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress', WAITING_FOR_CLIENT: 'Waiting for you', WAITING_FOR_MARKETPLACE: 'Waiting for the marketplace', RESOLVED: 'Resolved', CLOSED: 'Closed',
};

/** Plan §14 ticket lifecycle. Staff transitions; clients may only close a resolved ticket or reopen it. */
const STAFF_NEXT: Record<TicketStatus, TicketStatus[]> = {
  NEW: ['ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'RESOLVED', 'CLOSED'],
  ASSIGNED: ['IN_PROGRESS', 'WAITING_FOR_CLIENT', 'WAITING_FOR_MARKETPLACE', 'RESOLVED'],
  IN_PROGRESS: ['WAITING_FOR_CLIENT', 'WAITING_FOR_MARKETPLACE', 'RESOLVED'],
  WAITING_FOR_CLIENT: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  WAITING_FOR_MARKETPLACE: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['IN_PROGRESS'],
};
const OPEN: TicketStatus[] = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'WAITING_FOR_MARKETPLACE'];

/** manager-chat-support SLA (first acknowledgement). Business hours are approximated as calendar time. */
const ACK_MINUTES = { P1: 30, P2: 120, P3: 24 * 60, P4: 48 * 60 } as const;
export const ackDueAt = (t: { createdAt: Date; priority: keyof typeof ACK_MINUTES }) => new Date(t.createdAt.getTime() + ACK_MINUTES[t.priority] * 60_000);

const CreateSchema = z.object({
  category: z.enum(CATEGORIES),
  marketplace: z.enum(['AMAZON', 'FLIPKART']).optional(),
  subject: z.string().trim().min(4).max(200),
  description: z.string().trim().min(10).max(5000),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).default('P3'),
});

@Injectable()
export class TicketsService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService, private readonly access: AccessService, private readonly dispatch: DispatcherService) {}

  private shape<T extends { createdAt: Date; priority: 'P1' | 'P2' | 'P3' | 'P4'; firstResponseAt: Date | null; status: TicketStatus }>(t: T) {
    const due = ackDueAt(t);
    return { ...t, ackDueAt: due, ackOverdue: !t.firstResponseAt && OPEN.includes(t.status) && due < new Date(), statusLabel: STATUS_LABEL[t.status] };
  }

  /** Customer support staff work every client's tickets; others need client access. */
  private async canSee(user: AuthUser, ticket: { organizationId: string; assigneeId: string | null }) {
    if (user.type === 'CUSTOMER') return user.organizationId === ticket.organizationId;
    if (user.staffRole === 'SUPPORT_EXECUTIVE' || ticket.assigneeId === user.id) return true;
    return this.access.canAccessOrg(user, ticket.organizationId);
  }

  private async load(user: AuthUser, id: string) {
    const t = await this.db.supportTicket.findUnique({ where: { id }, include: { organization: { select: { legalName: true, brandName: true } } } });
    if (!t || !(await this.canSee(user, t))) throw new NotFoundException('Ticket not found');
    return t;
  }

  async create(user: AuthUser, input: unknown) {
    const d = parse(CreateSchema, input);
    const orgId = user.organizationId!;
    const ticket = await this.db.supportTicket.create({
      data: { organizationId: orgId, category: d.category, marketplace: d.marketplace, subject: d.subject, description: d.description, priority: d.priority, createdById: user.id },
    });
    await this.audit.log({ actor: user, action: 'ticket.create', entity: 'SupportTicket', entityId: ticket.id, after: { category: d.category, priority: d.priority } });
    const managers = await this.db.managerAssignment.findMany({ where: { organizationId: orgId, endedAt: null }, select: { managerId: true } });
    const org = await this.db.organization.findUniqueOrThrow({ where: { id: orgId } });
    await this.dispatch.notifyStaff({
      userIds: managers.map((m) => m.managerId), roles: ['SUPPORT_EXECUTIVE'], organizationId: orgId, type: 'ticket.created',
      title: `Ticket #${ticket.number} (${d.priority}) — ${org.brandName ?? org.legalName}`, body: d.subject,
    });
    await this.dispatch.emit({ type: 'ticket.created', organizationId: orgId, title: `Ticket #${ticket.number} received`, body: `We received "${d.subject}". First response due by ${ackDueAt(ticket).toLocaleString('en-IN')}.` });
    return this.shape(ticket);
  }

  async listForClient(user: AuthUser) {
    const rows = await this.db.supportTicket.findMany({ where: { organizationId: user.organizationId! }, orderBy: { updatedAt: 'desc' } });
    return rows.map((t) => this.shape(t));
  }

  async get(user: AuthUser, id: string) {
    const t = await this.load(user, id);
    const comments = await this.db.ticketComment.findMany({
      where: { ticketId: id, ...(user.type === 'CUSTOMER' ? { internal: false } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return { ...this.shape(t), comments };
  }

  async staffQueue(user: AuthUser, status?: string) {
    const statuses = status === 'ALL' ? undefined : status ? [status as TicketStatus] : OPEN;
    const orgIds = user.staffRole === 'SUPPORT_EXECUTIVE' ? null : await this.access.staffOrgIds(user);
    const rows = await this.db.supportTicket.findMany({
      where: {
        ...(statuses ? { status: { in: statuses } } : {}),
        ...(orgIds ? { OR: [{ organizationId: { in: orgIds } }, { assigneeId: user.id }] } : {}),
      },
      include: { organization: { select: { legalName: true, brandName: true } } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    return rows.map((t) => this.shape(t));
  }

  async comment(user: AuthUser, id: string, input: unknown) {
    const d = parse(z.object({ body: z.string().trim().min(1).max(5000), internal: z.boolean().default(false) }), input);
    const t = await this.load(user, id);
    if (user.type === 'CUSTOMER' && d.internal) throw new ForbiddenException('Only SOLLUNA staff can add internal notes');
    const isStaffReply = user.type === 'STAFF' && !d.internal;
    const c = await this.db.$transaction(async (tx) => {
      const comment = await tx.ticketComment.create({ data: { ticketId: id, authorId: user.id, authorType: user.type, authorName: user.type === 'STAFF' ? `${user.name} (SOLLUNA)` : user.name, body: d.body, internal: d.internal } });
      const data: Prisma.SupportTicketUpdateInput = {};
      if (isStaffReply && !t.firstResponseAt) data.firstResponseAt = new Date();
      // A client reply to a ticket waiting on them puts it back in SOLLUNA's court.
      if (user.type === 'CUSTOMER' && t.status === 'WAITING_FOR_CLIENT') {
        data.status = 'IN_PROGRESS';
        await tx.ticketComment.create({ data: { ticketId: id, authorType: 'SYSTEM', authorName: 'SOLLUNA', body: 'Client replied — back in progress', statusFrom: t.status, statusTo: 'IN_PROGRESS' } });
      }
      await tx.supportTicket.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
      return comment;
    });
    if (isStaffReply) {
      await this.dispatch.emit({ type: 'ticket.reply', organizationId: t.organizationId, title: `Reply on ticket #${t.number}`, body: d.body.slice(0, 300) });
    } else if (user.type === 'CUSTOMER') {
      await this.dispatch.notifyStaff({ userIds: t.assigneeId ? [t.assigneeId] : [], roles: t.assigneeId ? [] : ['SUPPORT_EXECUTIVE'], organizationId: t.organizationId, type: 'ticket.reply', title: `Client replied on ticket #${t.number}`, body: d.body.slice(0, 300) });
    }
    return c;
  }

  async update(user: AuthUser, id: string, input: unknown) {
    const d = parse(z.object({
      status: z.enum(['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'WAITING_FOR_MARKETPLACE', 'RESOLVED', 'CLOSED']).optional(),
      assigneeId: z.string().nullable().optional(),
      priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
      note: z.string().trim().max(2000).optional(),
    }), input);
    const t = await this.load(user, id);
    if (d.assigneeId) {
      const a = await this.db.user.findUnique({ where: { id: d.assigneeId } });
      if (!a || a.type !== 'STAFF' || !a.isActive) throw new BadRequestException('Assignee must be an active SOLLUNA staff member');
    }
    let status = d.status;
    if (!status && d.assigneeId && t.status === 'NEW') status = 'ASSIGNED';
    if (status && status !== t.status && !STAFF_NEXT[t.status].includes(status)) throw new BadRequestException(`Cannot move a ticket from ${STATUS_LABEL[t.status]} to ${STATUS_LABEL[status]}`);
    if (status === 'RESOLVED' && !d.note) throw new BadRequestException('Add a resolution note for the client');
    if (status === 'WAITING_FOR_CLIENT' && !d.note) throw new BadRequestException('Tell the client what you need from them');

    const changed = status && status !== t.status;
    await this.db.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id },
        data: {
          ...(changed ? { status } : {}),
          ...(d.assigneeId !== undefined ? { assigneeId: d.assigneeId } : {}),
          ...(d.priority ? { priority: d.priority } : {}),
          ...(status === 'RESOLVED' ? { resolvedAt: new Date() } : status && OPEN.includes(status) ? { resolvedAt: null } : {}),
          ...(changed && !t.firstResponseAt ? { firstResponseAt: new Date() } : {}),
        },
      });
      if (changed || d.note) {
        await tx.ticketComment.create({ data: { ticketId: id, authorId: user.id, authorType: 'STAFF', authorName: `${user.name} (SOLLUNA)`, body: d.note ?? `Status changed to ${STATUS_LABEL[status!]}`, statusFrom: changed ? t.status : null, statusTo: changed ? status : null } });
      }
      await this.audit.log({ actor: user, action: 'ticket.update', entity: 'SupportTicket', entityId: id, organizationId: t.organizationId, before: { status: t.status, assigneeId: t.assigneeId, priority: t.priority }, after: d }, tx);
    });
    if (changed) {
      await this.dispatch.emit({ type: 'ticket.status_changed', organizationId: t.organizationId, title: `Ticket #${t.number}: ${STATUS_LABEL[status!]}`, body: d.note ?? `Your ticket "${t.subject}" is now ${STATUS_LABEL[status!].toLowerCase()}.` });
    }
    if (d.assigneeId && d.assigneeId !== t.assigneeId) {
      await this.dispatch.notifyStaff({ userIds: [d.assigneeId], organizationId: t.organizationId, type: 'ticket.assigned', title: `Ticket #${t.number} assigned to you`, body: t.subject });
    }
    return this.get(user, id);
  }

  /** Client: close a resolved ticket, or reopen a resolved/closed one with a reason. */
  async clientAction(user: AuthUser, id: string, input: unknown) {
    const d = parse(z.object({ action: z.enum(['CLOSE', 'REOPEN']), note: z.string().trim().max(2000).optional() }), input);
    const t = await this.load(user, id);
    const to: TicketStatus = d.action === 'CLOSE' ? 'CLOSED' : 'IN_PROGRESS';
    if (d.action === 'CLOSE' && !['RESOLVED', 'WAITING_FOR_CLIENT'].includes(t.status)) throw new BadRequestException('Only a resolved ticket can be closed');
    if (d.action === 'REOPEN' && !['RESOLVED', 'CLOSED'].includes(t.status)) throw new BadRequestException('Only a resolved or closed ticket can be reopened');
    if (d.action === 'REOPEN' && !d.note) throw new BadRequestException('Tell us what is still not working');
    await this.db.$transaction(async (tx) => {
      await tx.supportTicket.update({ where: { id }, data: { status: to, ...(to === 'IN_PROGRESS' ? { resolvedAt: null } : {}) } });
      await tx.ticketComment.create({ data: { ticketId: id, authorId: user.id, authorType: 'CUSTOMER', authorName: user.name, body: d.note ?? (to === 'CLOSED' ? 'Closed by client' : 'Reopened by client'), statusFrom: t.status, statusTo: to } });
      await this.audit.log({ actor: user, action: `ticket.${d.action.toLowerCase()}`, entity: 'SupportTicket', entityId: id }, tx);
    });
    if (to === 'IN_PROGRESS') await this.dispatch.notifyStaff({ userIds: t.assigneeId ? [t.assigneeId] : [], roles: ['SUPPORT_EXECUTIVE'], organizationId: t.organizationId, type: 'ticket.reopened', title: `Ticket #${t.number} reopened`, body: d.note! });
    return this.get(user, id);
  }
}
