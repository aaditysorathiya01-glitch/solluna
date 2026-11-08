import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { FEATURES, FEATURE_KEYS, type FeatureKey } from '../../../../packages/permissions/src/features';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { config } from '../common/config';
import { DispatcherService } from '../connectors/dispatcher.service';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { ChatService, type ChatMessage } from './chat.service';
import { systemPrompt, TOOLS } from './manager-prompt';
import { checkInput, checkOutput, flagNotes, rewriteNote, SAFE_FALLBACK, type InputFlag, type OutputViolation } from './guardrails';

/**
 * Client manager agent (owner decision, 7 Nov 2026). Each client's assigned manager answers in Manager Chat through
 * Claude Haiku 5.5, following SOLLUNA's skills. Isolation: every run loads ONE organization's data, and every tool is
 * bound to that organization on the server — the model never chooses or sees another client.
 * Runs in the background (never inside an HTTP request). On only when ANTHROPIC_API_KEY is set and MANAGER_AGENT≠off.
 * No message limits for now (owner wants to watch the cost first): every run records tokens and estimated cost.
 */
export const AGENT_MODEL = process.env.MANAGER_AGENT_MODEL ?? 'claude-haiku-5-5';
/** USD per million tokens (Claude Haiku 5.5 list price; cache prices estimated). Override per env when prices change. */
const PRICE = {
  input: Number(process.env.AGENT_PRICE_INPUT ?? 0.1),
  output: Number(process.env.AGENT_PRICE_OUTPUT ?? 0.5),
  cacheRead: Number(process.env.AGENT_PRICE_CACHE_READ ?? 0.01),
  cacheWrite: Number(process.env.AGENT_PRICE_CACHE_WRITE ?? 0.125),
};
export const USD_INR = Number(process.env.USD_INR ?? 88);
const REPLY_DELAY_SEC = Number(process.env.AGENT_REPLY_DELAY_SEC ?? 15);
const HUMAN_QUIET_MIN = Number(process.env.AGENT_HUMAN_QUIET_MIN ?? 30);
const HISTORY = 40;
const MAX_TURNS = 6;

const MEMORY_KEY = z.string().trim().min(1).max(60).regex(/^[a-z0-9_.-]+$/i);
type Bound = { orgId: string; runId: string };

@Injectable()
export class ManagerAgentService implements OnModuleInit {
  private readonly log = new Logger('ManagerAgent');
  private running = false;

  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly dispatch: DispatcherService,
    private readonly orch: OrchestratorService,
    private readonly chat: ChatService,
  ) {
    chat.clientMessageListeners.push((orgId) => this.enqueue(orgId));
  }

  get enabled() { return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.MANAGER_AGENT !== 'off'; }

  onModuleInit() {
    setInterval(() => this.tick().catch((e) => this.log.error(e)), 2000).unref();
  }

  /** A client wrote: queue one reply (several quick messages are answered together after a short pause). */
  async enqueue(orgId: string) {
    if (!this.enabled) return;
    const conv = await this.db.conversation.findUnique({ where: { organizationId: orgId }, select: { agentPaused: true } });
    if (conv?.agentPaused) return;
    const queued = await this.db.agentRun.findFirst({ where: { organizationId: orgId, status: 'QUEUED' } });
    const dueAt = new Date(Date.now() + REPLY_DELAY_SEC * 1000);
    if (queued) await this.db.agentRun.update({ where: { id: queued.id }, data: { dueAt } });
    else await this.db.agentRun.create({ data: { organizationId: orgId, dueAt } });
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.db.agentRun.updateMany({ where: { status: 'RUNNING', createdAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: 'FAILED', note: 'timed out', finishedAt: new Date() } });
      for (let i = 0; i < 20; i++) {
        const next = await this.db.agentRun.findFirst({ where: { status: 'QUEUED', dueAt: { lte: new Date() } }, orderBy: { dueAt: 'asc' } });
        if (!next) return;
        const claimed = await this.db.agentRun.updateMany({ where: { id: next.id, status: 'QUEUED' }, data: { status: 'RUNNING' } });
        if (claimed.count) await this.run(next.id, next.organizationId);
      }
    } finally { this.running = false; }
  }

  private async finish(runId: string, status: string, note?: string) {
    await this.db.agentRun.update({ where: { id: runId }, data: { status, note: note?.slice(0, 300), finishedAt: new Date() } });
  }

  async run(runId: string, orgId: string) {
    try {
      const conv = await this.db.conversation.findUnique({ where: { organizationId: orgId } });
      if (!conv || conv.agentPaused) return this.finish(runId, 'SKIPPED', 'paused');
      const assignment = await this.db.managerAssignment.findFirst({ where: { organizationId: orgId, isPrimary: true, endedAt: null }, include: { manager: { select: { id: true, name: true, isActive: true } } } });
      if (!assignment?.manager.isActive) return this.finish(runId, 'SKIPPED', 'no manager assigned yet');
      // A person from the team is talking to this client: stay quiet.
      const human = await this.db.message.findFirst({ where: { conversationId: conv.id, senderType: 'STAFF', byAgent: false, isInternalNote: false, createdAt: { gte: new Date(Date.now() - HUMAN_QUIET_MIN * 60_000) } }, orderBy: { createdAt: 'desc' } });
      const lastClient = await this.db.message.findFirst({ where: { conversationId: conv.id, senderType: 'CUSTOMER' }, orderBy: { createdAt: 'desc' } });
      if (!lastClient) return this.finish(runId, 'SKIPPED', 'no client message');
      if (human) return this.finish(runId, 'SKIPPED', 'team member active in chat');

      const started = Date.now();
      const bound: Bound = { orgId, runId };
      const context = await this.clientFacts(orgId);
      const { messages, flags } = await this.history(conv.id, context);
      const client = new Anthropic();
      const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tools: 0 };
      const toolNames: string[] = [];
      let refused = false;
      const converse = async () => {
        let text = '';
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const res = await client.messages.create({
            model: AGENT_MODEL, max_tokens: 4000, cache_control: { type: 'ephemeral' },
            output_config: { effort: 'low' },
            system: systemPrompt(assignment.manager.name.split(' ')[0]), tools: TOOLS, messages,
          });
          usage.input += res.usage.input_tokens; usage.output += res.usage.output_tokens;
          usage.cacheRead += res.usage.cache_read_input_tokens ?? 0; usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;
          if (res.stop_reason === 'refusal') { refused = true; return ''; }
          const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
          text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
          if (!calls.length || res.stop_reason !== 'tool_use') return text;
          messages.push({ role: 'assistant', content: res.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const c of calls) {
            usage.tools++; toolNames.push(c.name);
            try { results.push({ type: 'tool_result', tool_use_id: c.id, content: await this.useTool(bound, c.name, c.input) }); }
            catch (e) { results.push({ type: 'tool_result', tool_use_id: c.id, content: (e as Error).message.slice(0, 300), is_error: true }); }
          }
          messages.push({ role: 'user', content: results });
        }
        return '';
      };

      // Output guardrail: a failing draft is rewritten once, then replaced by a safe hand-off and escalated.
      const guardCtx = await this.guardContext(orgId);
      let text = await converse();
      let violations: OutputViolation[] = text ? checkOutput(text, guardCtx) : [];
      const firstViolations = violations;
      let fallback = false;
      if (violations.length && !refused) {
        messages.push({ role: 'assistant', content: text }, { role: 'user', content: `<guardrail>${rewriteNote(violations)}</guardrail>` });
        text = await converse();
        violations = text ? checkOutput(text, guardCtx) : [];
      }
      if (refused || violations.length) {
        fallback = true;
        text = SAFE_FALLBACK;
        await this.escalate(bound, { reason: refused ? 'The manager could not answer the last client message automatically.' : `Automatic reply blocked by guardrails (${violations.join(', ')}). Please answer the client.`, priority: 'P2' });
      }

      const bubbles = text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).slice(0, 3);
      for (const body of bubbles) await this.chat.postAsManager(orgId, assignment.manager.id, body, { byAgent: true, notify: body === bubbles[0] });
      const cost = (usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheRead * PRICE.cacheRead + usage.cacheWrite * PRICE.cacheWrite); // micro-USD (tokens × $/MTok)
      await this.db.agentRun.update({ where: { id: runId }, data: {
        status: 'DONE', model: AGENT_MODEL, inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite,
        costMicroUsd: Math.round(cost), toolCalls: usage.tools, replyMessages: bubbles.length, finishedAt: new Date(),
        trace: { inputFlags: flags, firstDraftViolations: firstViolations, rewritten: firstViolations.length > 0, fallback, refused, tools: toolNames, latencyMs: Date.now() - started } as Prisma.InputJsonValue,
      } });
    } catch (e) {
      const msg = e instanceof Anthropic.APIError ? `API ${e.status}: ${e.message}` : (e as Error).message;
      this.log.warn(`Run ${runId} for ${orgId} failed: ${msg}`);
      await this.finish(runId, 'FAILED', msg);
      await this.dispatch.notifyStaff({ roles: ['OPERATIONS_MANAGER'], organizationId: orgId, type: 'agent.failed', title: 'Client message needs a reply', body: 'The automatic manager reply failed. Please answer the client in Manager Chat.' }).catch(() => undefined);
    }
  }

  /** Everything the manager may know about THIS client, as plain text. */
  private async clientFacts(orgId: string) {
    const [org, sub, accounts, memory] = await Promise.all([
      this.db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { legalName: true, brandName: true, gstin: true, category: true, city: true, stateCode: true } }),
      this.db.subscription.findFirst({ where: { organizationId: orgId, status: { in: ['ACTIVE', 'GRACE_PERIOD', 'PAST_DUE'] } }, orderBy: { createdAt: 'desc' }, include: { plan: { include: { features: true } } } }),
      this.db.marketplaceAccount.findMany({ where: { organizationId: orgId }, select: { marketplace: true, hasAccount: true, storeName: true, sellerId: true, status: true } }),
      this.db.agentMemory.findMany({ where: { organizationId: orgId }, orderBy: { key: 'asc' }, take: 100 }),
    ]);
    const client = await this.db.user.findFirst({ where: { organizationId: orgId, type: 'CUSTOMER', isActive: true }, orderBy: { createdAt: 'asc' }, select: { name: true } });
    const included = sub ? sub.plan.features.filter((f) => f.enabled).map((f) => `${FEATURES[f.featureKey as FeatureKey]?.label ?? f.featureKey}${f.limitValue != null ? ` (${f.limitValue}/month)` : ''}`) : [];
    return [
      `Client: ${client?.name ?? '—'} · Company: ${org.legalName}${org.brandName ? ` · Brand: ${org.brandName}` : ''}${org.gstin ? ` · GSTIN: ${org.gstin}` : ''}${org.city ? ` · ${org.city}` : ''}`,
      `Plan: ${sub ? `${sub.plan.name} (${sub.status})` : 'no active plan'}`,
      `Included services: ${included.join('; ') || '—'}`,
      `Seller accounts: ${accounts.length ? accounts.map((a) => `${a.marketplace} ${a.hasAccount === false ? 'no account yet' : `${a.storeName ?? ''} ${a.sellerId ?? ''} status ${a.status}`}`).join('; ') : 'not recorded yet'}`,
      `Saved facts: ${memory.length ? memory.map((m) => `${m.key}=${m.value}`).join('; ') : 'none yet'}`,
    ].join('\n');
  }

  /** Recent chat as alternating turns: client = user, SOLLUNA = assistant. Internal notes are never included. */
  private async history(conversationId: string, facts: string): Promise<{ messages: Anthropic.MessageParam[]; flags: InputFlag[] }> {
    const rows = (await this.db.message.findMany({
      where: { conversationId, isInternalNote: false }, orderBy: { createdAt: 'desc' }, take: HISTORY,
      select: { body: true, senderType: true, attachments: { where: { deletedAt: null }, select: { fileName: true } } },
    })).reverse();
    const turns: { role: 'user' | 'assistant'; text: string }[] = [];
    let lastFlags: InputFlag[] = [];
    for (const r of rows) {
      const role = r.senderType === 'CUSTOMER' ? 'user' : 'assistant';
      // Input guardrail: secrets never reach the model; flags of the newest client message steer the reply.
      const checked = role === 'user' ? checkInput(r.body) : { text: r.body, flags: [] as InputFlag[] };
      if (role === 'user') lastFlags = checked.flags;
      const text = [checked.text, ...r.attachments.map((a) => `[attached file: ${a.fileName}]`)].filter(Boolean).join('\n');
      const last = turns[turns.length - 1];
      if (last && last.role === role) last.text += `\n\n${text}`; else turns.push({ role, text });
    }
    // Bubbles of the previous reply can land after the newest client message: the chat must end on the client.
    while (turns.length && turns[turns.length - 1].role === 'assistant') turns.pop();
    if (turns[0]?.role !== 'user') turns.unshift({ role: 'user', text: '(chat started)' });
    const msgs: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.text || '(empty)' }));
    // Client facts go with the latest client turn (fresh each time, after the cached history).
    const last = msgs[msgs.length - 1];
    const notes = flagNotes(lastFlags);
    last.content = `<client_facts>\n${facts}${notes.length ? `\nGuardrail notes:\n- ${notes.join('\n- ')}` : ''}\n</client_facts>\n\n${last.content as string}`;
    return { messages: msgs, flags: lastFlags };
  }

  private otherNames: { at: number; byOrg: Map<string, string[]> } | null = null;
  /** What the output check needs: this client's own identifiers and the names of every other client. */
  private async guardContext(orgId: string) {
    if (!this.otherNames || Date.now() - this.otherNames.at > 10 * 60_000) {
      const orgs = await this.db.organization.findMany({ select: { id: true, legalName: true, brandName: true }, take: 10_000 });
      this.otherNames = { at: Date.now(), byOrg: new Map(orgs.map((o) => [o.id, [o.legalName, o.brandName].filter((x): x is string => Boolean(x))])) };
    }
    const own = await this.db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { gstin: true, contactEmail: true, users: { select: { email: true } } } });
    const ownNames = new Set((this.otherNames.byOrg.get(orgId) ?? []).map((x) => x.toLowerCase()));
    const otherClientNames = [...this.otherNames.byOrg.entries()].filter(([id]) => id !== orgId).flatMap(([, n]) => n).filter((n) => !ownNames.has(n.toLowerCase()));
    return { ownGstin: own.gstin, ownEmails: [own.contactEmail, ...own.users.map((u) => u.email)], otherClientNames };
  }

  /** Tools are bound to the run's organization; the model cannot name another client. */
  private async useTool(b: Bound, name: string, input: unknown): Promise<string> {
    if (name === 'remember') {
      const d = z.object({ key: MEMORY_KEY, value: z.string().trim().min(1).max(500) }).parse(input);
      if (/\b(password|passwd|passcode|otp)\b/i.test(`${d.key} ${d.value}`.replace(/[_.-]/g, ' '))) return 'Not saved: passwords and OTPs are never stored.';
      await this.db.agentMemory.upsert({ where: { organizationId_key: { organizationId: b.orgId, key: d.key.toLowerCase() } }, create: { organizationId: b.orgId, key: d.key.toLowerCase(), value: d.value }, update: { value: d.value } });
      return `Saved ${d.key}.`;
    }
    if (name === 'set_seller_account') {
      const d = z.object({ marketplace: z.enum(['AMAZON', 'FLIPKART']), has_account: z.boolean(), store_name: z.string().trim().max(200).nullable(), seller_id: z.string().trim().max(100).nullable() }).parse(input);
      const existing = await this.db.marketplaceAccount.findUnique({ where: { organizationId_marketplace: { organizationId: b.orgId, marketplace: d.marketplace } } });
      const data = { hasAccount: d.has_account, storeName: d.store_name || existing?.storeName || null, sellerId: d.seller_id || existing?.sellerId || null };
      // Never marks CONNECTED: that needs staff-verified evidence.
      if (existing) await this.db.marketplaceAccount.update({ where: { id: existing.id }, data: { ...data, status: existing.status === 'CONNECTED' ? 'CONNECTED' : 'PENDING' } });
      else await this.db.marketplaceAccount.create({ data: { organizationId: b.orgId, marketplace: d.marketplace, ...data, status: 'PENDING' } });
      await this.audit.log({ action: 'agent.seller_account', entity: 'MarketplaceAccount', organizationId: b.orgId, after: { marketplace: d.marketplace, hasAccount: d.has_account } });
      return `Recorded ${d.marketplace}: ${d.has_account ? 'has an account (awaiting verification)' : 'no account yet'}.`;
    }
    if (name === 'create_service_request') {
      const d = z.object({ feature_key: z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]), title: z.string().trim().min(3).max(120), details: z.string().trim().max(2000) }).parse(input);
      const req = await this.orch.systemIntake(b.orgId, d.feature_key, d.title, { source: 'manager-chat', clientAsk: d.details, agentRunId: b.runId });
      if (req.entitlement === 'OUT_OF_PLAN') return `Not in the client's plan: ${FEATURES[d.feature_key].label}. Request recorded as out of plan; tell the client which plan includes it.`;
      if (req.entitlement === 'LIMIT_REACHED') return 'The monthly limit for this service is used up; the request is waiting. Tell the client.';
      return `Request opened: "${req.title}" (status ${req.status}).`;
    }
    if (name === 'escalate_to_team') {
      const d = z.object({ reason: z.string().trim().min(3).max(1000), priority: z.enum(['P1', 'P2', 'P3', 'P4']) }).parse(input);
      await this.escalate(b, d);
      return 'The team has been alerted.';
    }
    throw new Error(`Unknown tool ${name}`);
  }

  private async escalate(b: Bound, d: { reason: string; priority: string }) {
    const a = await this.db.managerAssignment.findFirst({ where: { organizationId: b.orgId, isPrimary: true, endedAt: null }, select: { managerId: true } });
    if (a) await this.chat.postAsManager(b.orgId, a.managerId, `Escalated to the team (${d.priority}): ${d.reason}`, { internal: true, byAgent: true });
    await this.dispatch.notifyStaff({ roles: ['OPERATIONS_MANAGER', 'SUPPORT_EXECUTIVE'], organizationId: b.orgId, type: 'agent.escalation', title: `Client chat needs the team (${d.priority})`, body: d.reason.slice(0, 300) });
    await this.audit.log({ action: 'agent.escalate', entity: 'Organization', entityId: b.orgId, organizationId: b.orgId, after: d });
  }

  // ───────── Staff controls and spend ─────────

  async setPaused(orgId: string, paused: boolean) {
    await this.db.conversation.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, agentPaused: paused }, update: { agentPaused: paused } });
    if (paused) await this.db.agentRun.updateMany({ where: { organizationId: orgId, status: 'QUEUED' }, data: { status: 'SKIPPED', note: 'paused by team', finishedAt: new Date() } });
    return { organizationId: orgId, agentPaused: paused };
  }

  async memory(orgId: string) {
    return this.db.agentMemory.findMany({ where: { organizationId: orgId }, orderBy: { key: 'asc' }, select: { key: true, value: true, updatedAt: true } });
  }

  /** Spend per client for a month (YYYY-MM, IST calendar is close enough for cost watching). */
  async usage(month?: string) {
    const m = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : new Date().toISOString().slice(0, 7);
    const from = new Date(`${m}-01T00:00:00Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const rows = await this.db.agentRun.groupBy({
      by: ['organizationId'], where: { status: 'DONE', createdAt: { gte: from, lt: to } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, costMicroUsd: true, replyMessages: true, toolCalls: true }, _count: { _all: true },
    });
    const orgs = await this.db.organization.findMany({ where: { id: { in: rows.map((r) => r.organizationId) } }, select: { id: true, legalName: true, brandName: true } });
    const clients = rows.map((r) => {
      const usd = (r._sum.costMicroUsd ?? 0) / 1e6;
      const o = orgs.find((x) => x.id === r.organizationId);
      return { organizationId: r.organizationId, name: o?.brandName ?? o?.legalName ?? r.organizationId, replies: r._count._all, messages: r._sum.replyMessages ?? 0, toolCalls: r._sum.toolCalls ?? 0,
        inputTokens: r._sum.inputTokens ?? 0, outputTokens: r._sum.outputTokens ?? 0, cacheReadTokens: r._sum.cacheReadTokens ?? 0, costUsd: Math.round(usd * 10000) / 10000, costInr: Math.round(usd * USD_INR * 100) / 100 };
    }).sort((a, b) => b.costUsd - a.costUsd);
    const totalUsd = clients.reduce((s, c) => s + c.costUsd, 0);
    return { month: m, model: AGENT_MODEL, enabled: this.enabled, usdInr: USD_INR, clients, totalUsd: Math.round(totalUsd * 10000) / 10000, totalInr: Math.round(totalUsd * USD_INR * 100) / 100, note: 'Estimated from token counts × list prices; the Anthropic Console bill is the final figure.' };
  }
}

export type { ChatMessage };
