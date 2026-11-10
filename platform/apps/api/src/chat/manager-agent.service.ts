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
import { PipelineService } from './pipeline.service';
import { PIPELINE_KEYS, stepsOf } from './pipelines';
import { checkInput, checkOutput, flagNotes, rewriteNote, SAFE_FALLBACK, SOFT_VIOLATIONS, type InputFlag, type OutputViolation } from './guardrails';

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
/** Recent messages sent as-is; older ones live in a rolling summary (memory pattern adapted from claude-mem). */
const HISTORY = Number(process.env.AGENT_HISTORY ?? 16);
const DIGEST_AFTER = Number(process.env.AGENT_DIGEST_AFTER ?? 24);
const DIGEST_SYSTEM = 'You keep the running notes for one client of SOLLUNA (Amazon / Flipkart account management). Update the notes with the new chat lines: what they sell, decisions, requests, pending items, preferences, language. Max 120 words, plain text, no greetings. Never include passwords, OTPs or card numbers.';
const MAX_TURNS = 6;

const MEMORY_KEY = z.string().trim().min(1).max(60).regex(/^[a-z0-9_.-]+$/i);
type Bound = { orgId: string; runId: string };

@Injectable()
export class ManagerAgentService implements OnModuleInit {
  private readonly log = new Logger('ManagerAgent');
  private running = false;
  /** Other services add short client facts (e.g. SKUs missing a purchase price) without a circular dependency. */
  readonly factProviders: ((orgId: string) => Promise<string | null>)[] = [];

  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly dispatch: DispatcherService,
    private readonly orch: OrchestratorService,
    private readonly chat: ChatService,
    private readonly pipelines: PipelineService,
  ) {
    // OTP / password capture runs first and always (even when automatic replies are off), then the reply is queued.
    chat.clientMessageListeners.push((orgId, body) => this.pipelines.capture(orgId, body));
    chat.clientMessageListeners.push((orgId) => this.enqueue(orgId));
    // The team finished a step: the manager updates the client without waiting for them to write.
    pipelines.clientTurnListeners.push((orgId, info) => this.enqueue(orgId, info));
  }

  get enabled() { return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.MANAGER_AGENT !== 'off'; }

  onModuleInit() {
    setInterval(() => this.tick().catch((e) => this.log.error(e)), 2000).unref();
  }

  /** A client wrote: queue one reply (several quick messages are answered together after a short pause). */
  async enqueue(orgId: string, update?: string) {
    if (!this.enabled) return;
    const conv = await this.db.conversation.findUnique({ where: { organizationId: orgId }, select: { agentPaused: true } });
    if (conv?.agentPaused) return;
    const queued = await this.db.agentRun.findFirst({ where: { organizationId: orgId, status: 'QUEUED' } });
    const dueAt = new Date(Date.now() + REPLY_DELAY_SEC * 1000);
    const note = update ? `update:${update}`.slice(0, 300) : undefined;
    // The client's own message wins: a reply already queued for them sees the newest pipeline step in the facts anyway.
    if (queued) await this.db.agentRun.update({ where: { id: queued.id }, data: update ? {} : { dueAt, note: null } });
    else await this.db.agentRun.create({ data: { organizationId: orgId, dueAt, note } });
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
      const runRow = await this.db.agentRun.findUnique({ where: { id: runId }, select: { note: true } });
      const update = runRow?.note?.startsWith('update:') ? runRow.note.slice(7) : undefined;
      const lastClient = await this.db.message.findFirst({ where: { conversationId: conv.id, senderType: 'CUSTOMER' }, orderBy: { createdAt: 'desc' } });
      if (!lastClient && !update) return this.finish(runId, 'SKIPPED', 'no client message');
      if (human) return this.finish(runId, 'SKIPPED', 'team member active in chat');

      const started = Date.now();
      const bound: Bound = { orgId, runId };
      const pipelineText = await this.pipelines.contextFor(orgId);
      const extra = (await Promise.all(this.factProviders.map((p) => p(orgId).catch(() => null)))).filter(Boolean).join('\n');
      const context = `${await this.clientFacts(orgId)}${extra ? `\n${extra}` : ''}${pipelineText ? `\n\n${pipelineText}` : ''}`;
      const secretStep = await this.secretStep(orgId);
      const { messages, flags } = await this.history(conv.id, context, secretStep.otp, secretStep.otp || secretStep.password, update);
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
      const guardCtx = { ...(await this.guardContext(orgId)), allowSecretRequest: secretStep.otp || secretStep.password };
      let text = await converse();
      let violations: OutputViolation[] = text ? checkOutput(text, guardCtx) : [];
      const firstViolations = violations;
      let fallback = false;
      if (violations.length && !refused) {
        messages.push({ role: 'assistant', content: text }, { role: 'user', content: `<guardrail>${rewriteNote(violations)}</guardrail>` });
        text = await converse();
        violations = text ? checkOutput(text, guardCtx) : [];
      }
      // Style alone (soft) never blocks a reply after the one rewrite.
      violations = violations.filter((x) => !SOFT_VIOLATIONS.includes(x));
      if (refused || violations.length) {
        fallback = true;
        text = SAFE_FALLBACK;
        await this.escalate(bound, { reason: refused ? 'The manager could not answer the last client message automatically.' : `Automatic reply blocked by guardrails (${violations.join(', ')}). Please answer the client.`, priority: 'P2' });
      }

      await this.digest(orgId, conv.id).catch((e) => this.log.warn(`Digest for ${orgId} failed: ${(e as Error).message}`));
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
    const summary = memory.find((m) => m.key === 'chat_summary')?.value;
    const facts = memory.filter((m) => !m.key.startsWith('chat_summary'));
    return [
      `Client: ${client?.name ?? '—'} · Company: ${org.legalName}${org.brandName ? ` · Brand: ${org.brandName}` : ''}${org.gstin ? ` · GSTIN: ${org.gstin}` : ''}${org.city ? ` · ${org.city}` : ''}`,
      `Plan: ${sub ? `${sub.plan.name} (${sub.status})` : 'no active plan'}`,
      `Included services: ${included.join('; ') || '—'}`,
      `Seller accounts: ${accounts.length ? accounts.map((a) => `${a.marketplace} ${a.hasAccount === false ? 'no account yet' : `${a.storeName ?? ''} ${a.sellerId ?? ''} status ${a.status}`}`).join('; ') : 'not recorded yet'}`,
      `Saved facts: ${facts.length ? facts.map((m) => `${m.key}=${m.value}`).join('; ') : 'none yet'}`,
      ...(summary ? [`Earlier chat (summary): ${summary}`] : []),
    ].join('\n');
  }

  /** Recent chat as alternating turns: client = user, SOLLUNA = assistant. Internal notes are never included. */
  private async history(conversationId: string, facts: string, otpStep = false, secretStep = false, update?: string): Promise<{ messages: Anthropic.MessageParam[]; flags: InputFlag[] }> {
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
      // Inside an OTP / password step every code-like number is hidden too (a bare "482913").
      if (role === 'user' && otpStep) checked.text = checked.text.replace(/(?<!\d)\d{4,8}(?!\d)/g, '[hidden by SOLLUNA]');
      if (role === 'user') lastFlags = checked.flags;
      const text = [checked.text, ...r.attachments.map((a) => `[attached file: ${a.fileName}]`)].filter(Boolean).join('\n');
      const last = turns[turns.length - 1];
      if (last && last.role === role) last.text += `\n\n${text}`; else turns.push({ role, text });
    }
    if (update) {
      // Proactive update: keep the whole chat and add the team's news as the last (system) turn.
      const note = `(SOLLUNA system update, not from the client) ${update} Message the client now about it, following the current pipeline step.`;
      if (turns[turns.length - 1]?.role === 'user') turns[turns.length - 1].text += `\n\n${note}`; else turns.push({ role: 'user', text: note });
    }
    // Bubbles of the previous reply can land after the newest client message: the chat must end on the client.
    while (turns.length && turns[turns.length - 1].role === 'assistant') turns.pop();
    if (turns[0]?.role !== 'user') turns.unshift({ role: 'user', text: '(chat started)' });
    const msgs: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.text || '(empty)' }));
    // Client facts go with the latest client turn (fresh each time, after the cached history).
    const last = msgs[msgs.length - 1];
    const notes = secretStep && lastFlags.includes('secret_shared')
      ? ['The client sent the OTP / password for the sign-up step. It was captured securely and passed to the team. Thank them briefly; do not repeat it and do not warn them.', ...flagNotes(lastFlags.filter((f) => f !== 'secret_shared'))]
      : flagNotes(lastFlags);
    last.content = `<client_facts>\n${facts}${notes.length ? `\nGuardrail notes:\n- ${notes.join('\n- ')}` : ''}\n</client_facts>\n\n${last.content as string}`;
    return { messages: msgs, flags: lastFlags };
  }

  /** Whether a registration step is waiting for an OTP and / or the account password. */
  private async secretStep(orgId: string) {
    const out = { otp: false, password: false };
    for (const run of await this.pipelines.active(orgId)) {
      const step = stepsOf(run.pipeline, run.branch)[run.stepIndex];
      if (step?.fields.some((f) => f.kind === 'otp')) out.otp = true;
      if (step?.fields.some((f) => f.key === 'password')) out.password = true;
    }
    return out;
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

  /**
   * Rolling chat summary: when enough messages have fallen out of the recent window, fold them into the client's
   * `chat_summary` memory. The next replies send only the summary + recent messages, so long chats stay cheap.
   */
  private async digest(orgId: string, conversationId: string) {
    const until = (await this.db.agentMemory.findUnique({ where: { organizationId_key: { organizationId: orgId, key: 'chat_summary_until' } } }))?.value;
    const recent = await this.db.message.findMany({ where: { conversationId, isInternalNote: false }, orderBy: { createdAt: 'desc' }, take: HISTORY, select: { createdAt: true } });
    if (recent.length < HISTORY) return;
    const windowStart = recent[recent.length - 1].createdAt;
    const older = await this.db.message.findMany({
      where: { conversationId, isInternalNote: false, createdAt: { lt: windowStart, ...(until ? { gt: new Date(until) } : {}) } },
      orderBy: { createdAt: 'asc' }, take: 200, select: { body: true, senderType: true, createdAt: true },
    });
    if (older.length < DIGEST_AFTER) return;
    const previous = (await this.db.agentMemory.findUnique({ where: { organizationId_key: { organizationId: orgId, key: 'chat_summary' } } }))?.value ?? '(none yet)';
    const lines = older.map((m) => `${m.senderType === 'CUSTOMER' ? 'Client' : 'Manager'}: ${checkInput(m.body).text}`).join('\n');
    const res = await new Anthropic().messages.create({
      model: AGENT_MODEL, max_tokens: 1000, output_config: { effort: 'low' }, system: DIGEST_SYSTEM,
      messages: [{ role: 'user', content: `Current notes:\n${previous}\n\nNew chat lines:\n${lines}` }],
    });
    const notes = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(' ').trim().slice(0, 1200);
    const cost = res.usage.input_tokens * PRICE.input + res.usage.output_tokens * PRICE.output;
    await this.db.agentRun.create({ data: { organizationId: orgId, status: 'DONE', model: AGENT_MODEL, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, costMicroUsd: Math.round(cost), note: 'chat summary', finishedAt: new Date(), trace: { kind: 'digest', messages: older.length } } });
    if (!notes) return;
    const last = older[older.length - 1].createdAt.toISOString();
    for (const [key, value] of [['chat_summary', notes], ['chat_summary_until', last]] as const) {
      await this.db.agentMemory.upsert({ where: { organizationId_key: { organizationId: orgId, key } }, create: { organizationId: orgId, key, value }, update: { value } });
    }
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
    if (name === 'start_pipeline') {
      const d = z.object({ pipeline: z.enum(PIPELINE_KEYS), marketplace: z.enum(['AMAZON', 'FLIPKART']), has_account: z.boolean().nullable() }).parse(input);
      if (d.pipeline === 'SELLER_ACCOUNT_REGISTRATION') {
        if (d.has_account === null) throw new Error('has_account is needed for SELLER_ACCOUNT_REGISTRATION');
        await this.useTool(b, 'set_seller_account', { marketplace: d.marketplace, has_account: d.has_account, store_name: null, seller_id: null });
      } else if (d.pipeline === 'BRAND_APPROVAL' || d.pipeline === 'MARKETPLACE_SUPPORT') {
        // Client services: the plan check runs first (and the request is tracked for the team).
        const label = d.pipeline === 'BRAND_APPROVAL' ? 'brand approval' : 'seller-support ticket';
        const req = await this.orch.systemIntake(b.orgId, d.pipeline, `${d.marketplace === 'AMAZON' ? 'Amazon' : 'Flipkart'} ${label}`, { source: 'manager-chat', marketplace: d.marketplace, agentRunId: b.runId });
        if (req.entitlement !== 'ALLOWED') return `This service is not available right now (${req.entitlement}). Tell the client and offer the team's help.`;
      }
      const run = await this.pipelines.start(b.orgId, d.pipeline, d.marketplace, d.has_account);
      const step = stepsOf(run.pipeline, run.branch)[run.stepIndex];
      return `Pipeline ${d.pipeline} started for ${d.marketplace}. Current step: ${step?.title}. Follow the step instructions in the facts.`;
    }
    if (name === 'pipeline_save') {
      const d = z.object({ pipeline: z.enum(PIPELINE_KEYS), marketplace: z.enum(['AMAZON', 'FLIPKART']), field: z.string().trim().min(1).max(40), value: z.string().max(500) }).parse(input);
      return this.pipelines.save(b.orgId, d.pipeline, d.marketplace, d.field, d.value);
    }
    if (name === 'generate_temp_password') {
      const d = z.object({ marketplace: z.enum(['AMAZON', 'FLIPKART']) }).parse(input);
      return this.pipelines.generatePassword(b.orgId, d.marketplace);
    }
    if (name === 'pipeline_next') {
      const d = z.object({ pipeline: z.enum(PIPELINE_KEYS), marketplace: z.enum(['AMAZON', 'FLIPKART']) }).parse(input);
      return this.pipelines.next(b.orgId, d.pipeline, d.marketplace);
    }
    if (name === 'save_product_cost') {
      const d = z.object({ sku: z.string().trim().min(1).max(200), cost_inr: z.number().positive().max(10_000_000), includes_gst: z.boolean() }).parse(input);
      // Effective from the start of last month, so it applies to the report being prepared.
      const from = new Date(Date.now() + 330 * 60_000); from.setUTCDate(1); from.setUTCMonth(from.getUTCMonth() - 1); from.setUTCHours(0, 0, 0, 0);
      const row = await this.db.productCost.create({ data: { organizationId: b.orgId, sku: d.sku, costPaise: Math.round(d.cost_inr * 100), includesGst: d.includes_gst, effectiveFrom: from, clientConfirmed: true, enteredById: 'manager-chat' } });
      await this.audit.log({ action: 'product_cost.add', entity: 'ProductCost', entityId: row.id, organizationId: b.orgId, after: { sku: d.sku, costPaise: row.costPaise, by: 'manager-chat (client said)' } });
      return `Saved purchase price ₹${d.cost_inr} per unit for ${d.sku}.`;
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
