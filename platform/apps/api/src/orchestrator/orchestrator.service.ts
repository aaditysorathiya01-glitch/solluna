import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Marketplace, Prisma, ServiceRequest, Task, TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { FEATURES, FEATURE_KEYS, ORCHESTRATOR_SKILL, type FeatureKey } from '../../../../packages/permissions/src/features';
import { ROLE_FEATURES } from '../../../../packages/permissions/src/roles';
import { FEATURE_CONNECTORS } from '../../../../packages/permissions/src/connectors';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/zod';
import { config } from '../common/config';
import { EntitlementsService } from '../features/entitlements.service';
import { SkillsService } from '../features/skills.service';
import { DispatcherService } from '../connectors/dispatcher.service';
import { BillingService } from '../billing/billing.service';
import type { AuthUser } from '../auth/auth.types';
import { FIXED_MARKETPLACE, MARKETPLACE_REQUIRED, Step, workflowFor } from './workflows';
import { STAFF_TRANSITIONS, isTerminal } from './state-machine';

type Tx = Prisma.TransactionClient;
type Evidence = Record<string, unknown> & {
  summary?: string; outputUrl?: string; marketplaceRef?: string; outcome?: string; catalogId?: string; confidence?: string;
  approvalParameters?: Record<string, unknown>;
};

const SKIPPED = 'Skipped: ';
const isSkipped = (t: Task) => t.status === 'CANCELLED' && (t.blocker ?? '').startsWith(SKIPPED);

const IntakeSchema = z.object({
  featureKey: z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]),
  title: z.string().trim().min(3).max(200),
  details: z.record(z.string(), z.unknown()).default({}),
  marketplace: z.enum(['AMAZON', 'FLIPKART']).optional(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).default('P3'),
});

const TransitionSchema = z.object({
  status: z.enum(['QUEUED', 'IN_PROGRESS', 'AWAITING_INFORMATION', 'UNDER_MARKETPLACE_REVIEW', 'BLOCKED', 'COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED']),
  evidence: z.record(z.string(), z.unknown()).optional(),
  blocker: z.string().trim().min(3).max(1000).optional(),
});

const STATUS_LABEL: Record<TaskStatus, string> = {
  NEW: 'New', AWAITING_INFORMATION: 'Awaiting information', AWAITING_CLIENT_APPROVAL: 'Awaiting your approval', PLAN_VERIFICATION: 'Plan verification',
  QUEUED: 'Queued', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', UNDER_MARKETPLACE_REVIEW: 'Under marketplace review',
  COMPLETED: 'Completed', PARTIALLY_COMPLETED: 'Partially completed', CANCELLED: 'Cancelled',
};

/**
 * Executable form of the solluna-skill-orchestrator skill:
 *  Step 1–2  intake + plan/entitlement check (backend-enforced, quota reserved under a per-org lock)
 *  Step 3–4  route to specialist skills and build the dependency graph (workflows.ts)
 *  Step 5    track tasks through the orchestrator status vocabulary
 *  Step 6    QA: completion requires evidence; approvals gate consequential actions
 *  Step 7    client update in the orchestrator's fixed format
 */
@Injectable()
export class OrchestratorService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly ent: EntitlementsService,
    private readonly skills: SkillsService,
    private readonly audit: AuditService,
    private readonly dispatch: DispatcherService,
    private readonly billing: BillingService,
  ) {}

  onModuleInit() {
    this.billing.onActivated = (orgId) => this.reverify(orgId);
  }

  // ───────────────────────── Intake (Steps 1–4) ─────────────────────────

  async intake(user: AuthUser, input: unknown) {
    const d = parse(IntakeSchema, input);
    const orgId = user.organizationId!;
    const marketplace = (FIXED_MARKETPLACE[d.featureKey] ?? d.marketplace) as Marketplace | undefined;
    if (MARKETPLACE_REQUIRED.includes(d.featureKey) && !marketplace) throw new BadRequestException('Select Amazon or Flipkart for this request');
    if (FIXED_MARKETPLACE[d.featureKey] && d.marketplace && d.marketplace !== FIXED_MARKETPLACE[d.featureKey]) {
      throw new BadRequestException(`${FEATURES[d.featureKey].label} is for ${FIXED_MARKETPLACE[d.featureKey]} only`);
    }
    const wf = workflowFor(d.featureKey);

    const request = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}))`; // serialize quota reservations per org
      const req = await tx.serviceRequest.create({
        data: {
          organizationId: orgId, featureKey: d.featureKey, workflow: wf.id, marketplace, title: d.title,
          details: { ...d.details, priority: d.priority } as Prisma.InputJsonValue, createdById: user.id, entitlement: 'PENDING_VERIFICATION', status: 'NEW',
        },
      });
      await this.expand(tx, req.id);
      await this.audit.log({ actor: user, action: 'request.create', entity: 'ServiceRequest', entityId: req.id, after: { featureKey: d.featureKey, workflow: wf.id } }, tx);
      return tx.serviceRequest.findUniqueOrThrow({ where: { id: req.id } });
    }, { timeout: 15_000 });

    const update = await this.clientUpdate(request.id, orgId);
    await this.dispatch.emit({ type: 'request.created', organizationId: orgId, title: `Request received: ${request.title}`, body: update.text, data: { requestId: request.id, status: request.status } });
    return { request, update };
  }

  /** Entitlement check + task graph creation for a request. Re-runnable for PLAN_VERIFICATION requests. */
  private async expand(tx: Tx, requestId: string) {
    const req = await tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId } });
    const feature = req.featureKey as FeatureKey;
    const e = await this.ent.context(req.organizationId, tx);
    const r = this.ent.check(e, feature);

    if (!r.allowed) {
      const entitlement = r.reason === 'PENDING_VERIFICATION' ? 'PENDING_VERIFICATION' : r.reason === 'LIMIT_REACHED' ? 'LIMIT_REACHED' : 'OUT_OF_PLAN';
      await tx.serviceRequest.update({ where: { id: req.id }, data: { entitlement, status: entitlement === 'PENDING_VERIFICATION' ? 'PLAN_VERIFICATION' : 'BLOCKED' } });
      return;
    }

    const wf = workflowFor(feature);
    const details = (req.details ?? {}) as Record<string, unknown>;
    const included = wf.steps.filter((s) => {
      if (s.ifDetail && !details[s.ifDetail]) return false;
      if (s.ifEntitled) return this.ent.check(e, this.stepFeature(s, feature)).allowed;
      return true;
    });
    // Every mandatory step must be inside the plan, otherwise the whole request is out of plan.
    const outside = included.filter((s) => !s.ifEntitled && this.stepFeature(s, feature) !== feature && !this.ent.check(e, this.stepFeature(s, feature)).allowed);
    if (outside.length) {
      await tx.serviceRequest.update({ where: { id: req.id }, data: { entitlement: 'OUT_OF_PLAN', status: 'BLOCKED' } });
      return;
    }

    const keys = new Set(included.map((s) => s.key));
    const ids = new Map<string, string>();
    const priority = (details.priority as 'P1' | 'P2' | 'P3' | 'P4') ?? 'P3';
    for (const [stepIndex, s] of included.entries()) {
      const f = this.stepFeature(s, feature);
      const t = await tx.task.create({
        data: {
          organizationId: req.organizationId, requestId: req.id, stepKey: s.key, stepIndex, title: s.title, featureKey: f, skill: FEATURES[f].skill,
          marketplace: req.marketplace, priority, status: 'NEW', entitlement: 'ALLOWED', approvalAction: s.approval ?? null,
          requiredInputs: details as Prisma.InputJsonValue,
        },
      });
      ids.set(s.key, t.id);
    }
    for (const s of included) {
      const deps = (s.dependsOn ?? []).filter((k) => keys.has(k)).map((k) => ids.get(k)!);
      if (deps.length) await tx.task.update({ where: { id: ids.get(s.key)! }, data: { dependsOnIds: deps } });
    }
    await tx.serviceRequest.update({ where: { id: req.id }, data: { entitlement: 'ALLOWED', status: 'QUEUED' } });
    await this.propagate(tx, req.id);
  }

  private stepFeature(s: Step, requested: FeatureKey): FeatureKey {
    return s.feature === 'REQUESTED' ? requested : s.feature;
  }

  private stepDef(req: ServiceRequest, t: Task): Step | undefined {
    return workflowFor(req.featureKey as FeatureKey).steps.find((s) => s.key === t.stepKey);
  }

  /** Re-runs intake for requests that were waiting on plan verification (called after payment activation). */
  async reverify(orgId: string) {
    const pending = await this.db.serviceRequest.findMany({ where: { organizationId: orgId, status: 'PLAN_VERIFICATION' } });
    for (const p of pending) {
      await this.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}))`;
        await this.expand(tx, p.id);
      });
      const u = await this.clientUpdate(p.id, orgId);
      await this.dispatch.emit({ type: 'request.status_changed', organizationId: orgId, title: `Update: ${p.title}`, body: u.text, data: { requestId: p.id } });
    }
  }

  // ───────────────────────── Dependency propagation (Step 4–5) ─────────────────────────

  /** Moves waiting tasks forward: skip, cancel, unblock or open an approval gate. Repeats until stable. */
  private async propagate(tx: Tx, requestId: string): Promise<{ approvalsRequested: string[] }> {
    const req = await tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId } });
    const approvalsRequested: string[] = [];
    for (let changed = true; changed;) {
      changed = false;
      const tasks = await tx.task.findMany({ where: { requestId } });
      const byStep = new Map(tasks.map((t) => [t.stepKey, t]));
      const byId = new Map(tasks.map((t) => [t.id, t]));
      for (const t of tasks.filter((x) => x.status === 'NEW')) {
        const step = this.stepDef(req, t);
        const skipRef = step?.skipWhen && byStep.get(step.skipWhen.step);
        if (step?.skipWhen && skipRef?.status === 'COMPLETED' && (skipRef.evidence as Evidence | null)?.outcome === step.skipWhen.outcome) {
          await tx.task.update({ where: { id: t.id }, data: { status: 'CANCELLED', blocker: SKIPPED + step.skipWhen.reason } });
          changed = true; continue;
        }
        const deps = t.dependsOnIds.map((id) => byId.get(id)!).filter(Boolean);
        if (deps.some((x) => x.status === 'CANCELLED' && !isSkipped(x))) {
          await tx.task.update({ where: { id: t.id }, data: { status: 'CANCELLED', blocker: 'Cancelled because a prerequisite step was cancelled' } });
          changed = true; continue;
        }
        if (deps.some((x) => x.status === 'PARTIALLY_COMPLETED')) {
          await tx.task.update({ where: { id: t.id }, data: { status: 'BLOCKED', blocker: 'A prerequisite was only partially completed — SOLLUNA manager decision required' } });
          changed = true; continue;
        }
        if (deps.every((x) => x.status === 'COMPLETED' || isSkipped(x))) {
          if (t.approvalAction) {
            const params = Object.assign({}, ...deps.map((x) => (x.evidence as Evidence | null)?.approvalParameters ?? {}));
            const a = await tx.approval.create({
              data: { organizationId: t.organizationId, taskId: t.id, actionType: t.approvalAction, parameters: params as Prisma.InputJsonValue, requestedById: 'system:orchestrator' },
            });
            await tx.task.update({ where: { id: t.id }, data: { status: 'AWAITING_CLIENT_APPROVAL' } });
            approvalsRequested.push(a.id);
          } else {
            await tx.task.update({ where: { id: t.id }, data: { status: 'QUEUED' } });
          }
          changed = true;
        }
      }
    }
    await this.recomputeRequest(tx, requestId);
    return { approvalsRequested };
  }

  private async recomputeRequest(tx: Tx, requestId: string) {
    const tasks = await tx.task.findMany({ where: { requestId } });
    if (!tasks.length) return;
    const active = tasks.filter((t) => !isSkipped(t));
    let status: TaskStatus;
    if (active.every((t) => isTerminal(t.status))) {
      status = active.every((t) => t.status === 'COMPLETED') ? 'COMPLETED'
        : active.some((t) => t.status === 'COMPLETED' || t.status === 'PARTIALLY_COMPLETED') ? 'PARTIALLY_COMPLETED' : 'CANCELLED';
    } else {
      const order: TaskStatus[] = ['AWAITING_CLIENT_APPROVAL', 'AWAITING_INFORMATION', 'BLOCKED', 'UNDER_MARKETPLACE_REVIEW', 'IN_PROGRESS', 'QUEUED', 'NEW'];
      status = order.find((s) => active.some((t) => t.status === s)) ?? 'IN_PROGRESS';
      if (status === 'NEW') status = 'QUEUED';
    }
    await tx.serviceRequest.update({ where: { id: requestId }, data: { status } });
  }

  // ───────────────────────── Staff execution (Steps 5–6) ─────────────────────────

  private canWork(user: AuthUser, featureKey: string) {
    const allowed = ROLE_FEATURES[user.staffRole!];
    return allowed === 'ALL' || allowed.includes(featureKey as FeatureKey);
  }

  async transition(user: AuthUser, taskId: string, input: unknown) {
    const d = parse(TransitionSchema, input);
    const task = await this.db.task.findUnique({ where: { id: taskId }, include: { request: true } });
    if (!task || !this.canWork(user, task.featureKey)) throw new NotFoundException('Task not found');
    const allowed = STAFF_TRANSITIONS[task.status] ?? [];
    if (!allowed.includes(d.status)) throw new BadRequestException(`Cannot move a task from ${task.status} to ${d.status}`);

    const evidence = d.evidence as Evidence | undefined;
    if ((d.status === 'BLOCKED' || d.status === 'AWAITING_INFORMATION' || d.status === 'PARTIALLY_COMPLETED') && !d.blocker) {
      throw new BadRequestException('Describe the blocker / missing information');
    }
    if (d.status === 'QUEUED' && task.status === 'BLOCKED') {
      const deps = await this.db.task.findMany({ where: { id: { in: task.dependsOnIds } } });
      if (deps.some((x) => !(x.status === 'COMPLETED' || isSkipped(x)))) throw new BadRequestException('Prerequisite steps are not complete');
    }
    const step = task.request ? this.stepDef(task.request, task) : undefined;
    if (d.status === 'COMPLETED' || d.status === 'PARTIALLY_COMPLETED') await this.validateEvidence(task, step, d.status, evidence);

    const res = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${task.organizationId}))`;
      const fresh = await tx.task.findUniqueOrThrow({ where: { id: task.id } });
      if (fresh.status !== task.status) throw new BadRequestException('Task changed concurrently — reload and retry');
      const updated = await tx.task.update({
        where: { id: task.id },
        data: {
          status: d.status,
          blocker: d.blocker ?? (d.status === 'COMPLETED' ? null : fresh.blocker),
          evidence: evidence ? ({ ...((fresh.evidence as object) ?? {}), ...evidence } as Prisma.InputJsonValue) : undefined,
          assigneeId: fresh.assigneeId ?? user.id,
        },
      });
      if (d.status === 'COMPLETED' && step?.consumesQuota && evidence?.outcome === 'CATALOG_ID_CREATED') {
        await this.ent.consume(task.organizationId, task.request!.featureKey as FeatureKey, tx);
      }
      await this.audit.log({ actor: user, action: 'task.transition', entity: 'Task', entityId: task.id, organizationId: task.organizationId, before: { status: task.status }, after: { status: d.status, blocker: d.blocker, evidence } }, tx);
      const prop = task.requestId ? await this.propagate(tx, task.requestId) : { approvalsRequested: [] };
      return { updated, prop };
    }, { timeout: 15_000 });

    await this.notifyClient(task.organizationId, task.requestId, res.prop.approvalsRequested);
    return res.updated;
  }

  /** Step 6 QA: never convert an attempted action into a completed status without evidence. */
  private async validateEvidence(task: Task, step: Step | undefined, status: TaskStatus, ev: Evidence | undefined) {
    if (!ev || typeof ev.summary !== 'string' || ev.summary.trim().length < 10) throw new BadRequestException('Evidence summary (what was verified) is required');
    if (status === 'PARTIALLY_COMPLETED') return;
    if (!ev.outputUrl && !ev.marketplaceRef) throw new BadRequestException('Evidence must include outputUrl (approved delivery location) or marketplaceRef (marketplace confirmation)');
    if (ev.outputUrl) {
      let host: string;
      try { const u = new URL(String(ev.outputUrl)); if (u.protocol !== 'https:') throw new Error(); host = u.hostname; } catch { throw new BadRequestException('outputUrl must be a valid https URL'); }
      if (!config.approvedOutputHosts.includes(host)) throw new BadRequestException(`outputUrl must be on an approved delivery channel: ${config.approvedOutputHosts.join(', ')}`);
    }
    if (step?.outcomes) {
      if (!ev.outcome || !step.outcomes.includes(ev.outcome)) throw new BadRequestException(`Evidence outcome must be one of: ${step.outcomes.join(', ')}`);
      if (ev.outcome === 'EXISTING_FOUND') {
        if (!ev.catalogId) throw new BadRequestException('catalogId (ASIN/FSN) required for EXISTING_FOUND');
        if (!['EXACT_VERIFIED', 'HIGH_CONFIDENCE'].includes(String(ev.confidence))) {
          throw new BadRequestException('Only EXACT_VERIFIED or human-reviewed HIGH_CONFIDENCE matches may be confirmed (existing-catalog-mapping §7)');
        }
      }
      if (ev.outcome === 'CATALOG_ID_CREATED' && !ev.catalogId) throw new BadRequestException('catalogId (new ASIN/FSN) required');
    }
    const gated = await this.db.task.findFirst({ where: { requestId: task.requestId, dependsOnIds: { has: task.id }, approvalAction: { not: null } } });
    if (gated && (!ev.approvalParameters || !Object.keys(ev.approvalParameters).length)) {
      throw new BadRequestException(`Next step needs client approval (${gated.approvalAction}) — include approvalParameters (amounts, SKUs, dates) for the client to approve`);
    }
  }

  // ───────────────────────── Approvals ─────────────────────────

  async decideApproval(user: AuthUser, approvalId: string, input: unknown) {
    const { decision } = parse(z.object({ decision: z.enum(['APPROVED', 'DECLINED']) }), input);
    const a = await this.db.approval.findFirst({ where: { id: approvalId, organizationId: user.organizationId! } });
    if (!a) throw new NotFoundException('Approval not found');
    if (a.status !== 'REQUESTED') throw new BadRequestException(`Approval already ${a.status.toLowerCase()}`);
    const task = a.taskId ? await this.db.task.findUnique({ where: { id: a.taskId } }) : null;

    await this.db.$transaction(async (tx) => {
      await tx.approval.update({ where: { id: a.id }, data: { status: decision, decidedById: user.id, decidedAt: new Date() } });
      if (task) {
        await tx.task.update({
          where: { id: task.id },
          data: decision === 'APPROVED' ? { status: 'QUEUED' } : { status: 'CANCELLED', blocker: 'Client declined the approval' },
        });
        if (task.requestId) await this.propagate(tx, task.requestId);
      }
      await this.audit.log({ actor: user, action: 'approval.decide', entity: 'Approval', entityId: a.id, after: { decision, actionType: a.actionType, parameters: a.parameters } }, tx);
    });
    if (task) await this.notifyClient(task.organizationId, task.requestId, []);
    return this.db.approval.findUniqueOrThrow({ where: { id: a.id } });
  }

  listApprovals(user: AuthUser) {
    return this.db.approval.findMany({ where: { organizationId: user.organizationId! }, orderBy: { createdAt: 'desc' }, include: { task: { select: { title: true, requestId: true, skill: true } } } });
  }

  // ───────────────────────── Client update (Step 7) ─────────────────────────

  async clientUpdate(requestId: string, orgId: string) {
    const req = await this.db.serviceRequest.findFirst({ where: { id: requestId, organizationId: orgId }, include: { tasks: { orderBy: [{ stepIndex: 'asc' }, { createdAt: 'asc' }] } } });
    if (!req) throw new NotFoundException('Request not found');
    const label = FEATURES[req.featureKey as FeatureKey].label;
    const mp = req.marketplace ? ` (${req.marketplace === 'AMAZON' ? 'Amazon' : 'Flipkart'})` : '';
    const sections = { request: `${req.title} — ${label}${mp}`, status: STATUS_LABEL[req.status], completed: [] as string[], pending: [] as string[], next: '', charges: 'None.' };

    if (req.entitlement !== 'ALLOWED') {
      const e = await this.ent.context(orgId);
      const plan = e.subscription?.plan.name;
      if (req.entitlement === 'PENDING_VERIFICATION') {
        sections.status = 'Plan verification';
        sections.pending.push('Your payment is being verified. Work starts automatically once your plan is confirmed.');
        sections.next = 'SOLLUNA: confirm payment and start the request.';
      } else if (req.entitlement === 'LIMIT_REACHED') {
        const f = e.ctx.features.get(req.featureKey as FeatureKey);
        sections.status = 'Monthly allowance used';
        sections.pending.push(`Your ${plan} plan includes ${f?.limitValue} ${label.toLowerCase().replace(' / month', '')} per billing month, and this month's allowance is used or reserved.`);
        sections.next = 'SOLLUNA manager: confirm whether to schedule this for next billing month or offer an add-on. No work or charges start without your approval.';
      } else {
        sections.status = 'Outside your current plan';
        sections.pending.push(plan ? `${label} is not included in your ${plan} plan.` : 'You do not have an active plan yet.');
        sections.next = plan
          ? 'SOLLUNA manager: share add-on or upgrade options. No work or charges start without your approval.'
          : 'You: choose a plan in Billing to start this request.';
      }
      return { sections, text: this.render(sections) };
    }

    for (const t of req.tasks) {
      const ev = (t.evidence ?? {}) as Evidence;
      if (t.status === 'COMPLETED') sections.completed.push(`${t.title}${ev.summary ? ` — ${ev.summary}` : ''}${ev.outputUrl ? ` (${ev.outputUrl})` : ''}`);
      else if (isSkipped(t)) sections.completed.push(`${t.title} — not required. ${t.blocker!.slice(SKIPPED.length)}`);
      else if (['BLOCKED', 'AWAITING_INFORMATION', 'PARTIALLY_COMPLETED'].includes(t.status)) sections.pending.push(`${t.title}: ${t.blocker ?? STATUS_LABEL[t.status]}`);
      else if (t.status === 'UNDER_MARKETPLACE_REVIEW') sections.pending.push(`${t.title}: waiting for the marketplace's response`);
      else if (t.status === 'CANCELLED') sections.pending.push(`${t.title}: cancelled — ${t.blocker ?? ''}`.trim());
    }
    const nextTask = req.tasks.find((t) => !isTerminal(t.status));
    if (!nextTask) sections.next = 'No further action. This request is closed.';
    else if (nextTask.status === 'AWAITING_CLIENT_APPROVAL') sections.next = `You: review and approve "${nextTask.title}" in Approvals.`;
    else if (nextTask.status === 'AWAITING_INFORMATION') sections.next = `You: provide the missing information — ${nextTask.blocker}`;
    else sections.next = `SOLLUNA team: ${nextTask.title}.`;

    const pendingApprovals = await this.db.approval.findMany({ where: { organizationId: orgId, status: 'REQUESTED', taskId: { in: req.tasks.map((t) => t.id) } } });
    if (pendingApprovals.length) {
      sections.charges = pendingApprovals.map((a) => `${a.actionType.replace('_', ' ').toLowerCase()} approval needed: ${JSON.stringify(a.parameters)}`).join('; ');
    } else if (req.featureKey === 'ADS_MANAGEMENT') {
      sections.charges = 'Advertising spend is billed by the marketplace to you, separately from your SOLLUNA plan.';
    }
    return { sections, text: this.render(sections) };
  }

  private render(s: { request: string; status: string; completed: string[]; pending: string[]; next: string; charges: string }) {
    const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- None');
    return `**Request:** ${s.request}\n**Status:** ${s.status}\n**Completed:**\n${list(s.completed)}\n**Pending / Blocked:**\n${list(s.pending)}\n**Next step:** ${s.next}\n**Charges / Approval:** ${s.charges}`;
  }

  private async notifyClient(orgId: string, requestId: string | null, approvalIds: string[]) {
    if (!requestId) return;
    const u = await this.clientUpdate(requestId, orgId);
    await this.dispatch.emit({ type: approvalIds.length ? 'approval.requested' : 'request.status_changed', organizationId: orgId, title: `Update: ${u.sections.request}`, body: u.text, data: { requestId, approvalIds } });
  }

  // ───────────────────────── Queries ─────────────────────────

  listRequests(user: AuthUser) {
    return this.db.serviceRequest.findMany({
      where: { organizationId: user.organizationId! }, orderBy: { createdAt: 'desc' },
      include: { tasks: { select: { id: true, title: true, status: true, skill: true, stepKey: true, blocker: true }, orderBy: [{ stepIndex: 'asc' }, { createdAt: 'asc' }] } },
    });
  }

  async getRequest(user: AuthUser, id: string) {
    const req = await this.db.serviceRequest.findFirst({
      where: { id, organizationId: user.organizationId! },
      include: { tasks: { select: { id: true, title: true, status: true, skill: true, stepKey: true, blocker: true, updatedAt: true }, orderBy: [{ stepIndex: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!req) throw new NotFoundException('Request not found');
    return { request: req, update: await this.clientUpdate(id, user.organizationId!) };
  }

  async staffQueue(user: AuthUser, status?: string) {
    const allowed = ROLE_FEATURES[user.staffRole!];
    return this.db.task.findMany({
      where: {
        ...(allowed === 'ALL' ? {} : { featureKey: { in: allowed } }),
        ...(status ? { status: status as TaskStatus } : { status: { notIn: ['COMPLETED', 'CANCELLED', 'NEW'] } }),
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      include: { organization: { select: { legalName: true, brandName: true } }, request: { select: { title: true, featureKey: true } } },
      take: 200,
    });
  }

  /** Everything an operator (human or a Claude session) needs to execute a task with its skill. */
  async taskContext(user: AuthUser, taskId: string) {
    const task = await this.db.task.findUnique({ where: { id: taskId }, include: { request: true, organization: true, approvals: true } });
    if (!task || !this.canWork(user, task.featureKey)) throw new NotFoundException('Task not found');
    const e = await this.ent.context(task.organizationId);
    const step = task.request ? this.stepDef(task.request, task) : undefined;
    return {
      task,
      client: { id: task.organization.id, legalName: task.organization.legalName, brandName: task.organization.brandName, plan: e.subscription?.plan ?? null },
      skill: this.skills.get(task.skill),
      orchestrator: { name: ORCHESTRATOR_SKILL },
      connectors: FEATURE_CONNECTORS[task.featureKey as FeatureKey] ?? [],
      completionRequirements: {
        evidence: ['summary', 'outputUrl (approved delivery channel) or marketplaceRef'],
        approvedOutputHosts: config.approvedOutputHosts,
        outcomes: step?.outcomes ?? null,
        approvalParametersRequired: Boolean(await this.db.task.findFirst({ where: { requestId: task.requestId, dependsOnIds: { has: task.id }, approvalAction: { not: null } } })),
      },
      allowedTransitions: STAFF_TRANSITIONS[task.status] ?? [],
    };
  }

  async staffRequest(user: AuthUser, id: string) {
    const req = await this.db.serviceRequest.findUnique({ where: { id }, include: { tasks: { orderBy: [{ stepIndex: 'asc' }, { createdAt: 'asc' }] }, organization: { select: { legalName: true } } } });
    if (!req) throw new NotFoundException('Request not found');
    if (!req.tasks.some((t) => this.canWork(user, t.featureKey)) && ROLE_FEATURES[user.staffRole!] !== 'ALL') throw new ForbiddenException();
    return { request: req, update: await this.clientUpdate(id, req.organizationId) };
  }
}
