#!/usr/bin/env node
// Manager-agent evals (layer 8). Sends every scenario in manager-scenarios.json to the model with the production
// prompt, tools and guardrails, then grades the reply. Uses real API credits (Claude Haiku 5.5: a full run costs a
// few US cents) — run it after changing the prompt, tools, model or knowledge, and before deploying.
//
//   cd platform && npm run build -w @solluna/api
//   ANTHROPIC_API_KEY=… node apps/api/evals/run-manager-evals.mjs [--only id1,id2] [--min 0.85] [--dry]
//
// Writes apps/api/evals/results/manager-<time>.json. Exit code 1 when the score is below --min.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
process.env.JWT_SECRET ??= 'eval-only-secret-not-used-for-anything-0000';
const dist = join(here, '..', 'dist');
const { systemPrompt, TOOLS } = require(join(dist, 'apps/api/src/chat/manager-prompt.js'));
const { checkInput, checkOutput, flagNotes, rewriteNote } = require(join(dist, 'apps/api/src/chat/guardrails.js'));
const { FEATURES } = require(join(dist, 'packages/permissions/src/features.js'));

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('--only')?.split(',');
const min = Number(opt('--min') ?? 0);
const dry = args.includes('--dry');
const MODEL = process.env.MANAGER_AGENT_MODEL ?? 'claude-haiku-5-5';
const PRICE = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 };

const suite = JSON.parse(readFileSync(join(here, 'manager-scenarios.json'), 'utf8'));
const scenarios = suite.scenarios.filter((s) => !only || only.includes(s.id));

// ── validate the file (also what --dry does) ──
const problems = [];
const seen = new Set();
const toolNames = new Set(TOOLS.map((t) => t.name));
for (const s of suite.scenarios) {
  if (!s.id || seen.has(s.id)) problems.push(`duplicate or missing id: ${s.id}`); seen.add(s.id);
  if (!Array.isArray(s.chat) || !s.chat.length || s.chat[s.chat.length - 1][0] !== 'client') problems.push(`${s.id}: chat must end with a client message`);
  for (const [who] of s.chat ?? []) if (!['client', 'manager'].includes(who)) problems.push(`${s.id}: speaker must be client or manager`);
  for (const t of [...(s.expect?.tools ?? []), ...(Array.isArray(s.expect?.noTools) ? s.expect.noTools : [])]) if (!toolNames.has(t)) problems.push(`${s.id}: unknown tool ${t}`);
  for (const r of [...(s.expect?.mustMatch ?? []), ...(s.expect?.mustNotMatch ?? [])]) { try { new RegExp(r, 'i'); } catch { problems.push(`${s.id}: bad regex ${r}`); } }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(2); }
if (dry) { console.log(`OK: ${suite.scenarios.length} scenarios valid`); process.exit(0); }

const { default: Anthropic } = await import('@anthropic-ai/sdk');
const client = new Anthropic();
const d = suite.defaults;
const planCode = d.plan.toUpperCase();

function facts(s) {
  return [
    `Client: ${d.client} · Company: ${d.company}`,
    `Plan: ${s.plan ?? d.plan} (ACTIVE)`,
    `Included services: ${s.included ?? d.included}`,
    `Seller accounts: ${s.accounts ?? 'not recorded yet'}`,
    s.facts ?? 'Saved facts: none yet',
  ].join('\n');
}

function build(s) {
  const turns = [];
  let flags = [];
  for (const [who, text] of s.chat) {
    const role = who === 'client' ? 'user' : 'assistant';
    const t = role === 'user' ? checkInput(text) : { text, flags: [] };
    if (role === 'user') flags = t.flags;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${t.text}`; else turns.push({ role, content: t.text });
  }
  if (turns[0].role !== 'user') turns.unshift({ role: 'user', content: '(chat started)' });
  const notes = flagNotes(flags);
  const last = turns[turns.length - 1];
  last.content = `<client_facts>\n${facts(s)}${notes.length ? `\nGuardrail notes:\n- ${notes.join('\n- ')}` : ''}\n</client_facts>\n\n${last.content}`;
  return turns;
}

/** Stand-ins for the real tools: same answers the service gives, nothing is written anywhere. */
function fakeTool(name, input) {
  if (name === 'remember') return /password|otp/i.test(`${input.key} ${input.value}`) ? 'Not saved: passwords and OTPs are never stored.' : `Saved ${input.key}.`;
  if (name === 'set_seller_account') return `Recorded ${input.marketplace}: ${input.has_account ? 'has an account (awaiting verification)' : 'no account yet'}.`;
  if (name === 'create_service_request') {
    const f = FEATURES[input.feature_key];
    if (!f?.plans?.[planCode]?.enabled) return `Not in the client's plan: ${f?.label ?? input.feature_key}. Request recorded as out of plan; tell the client which plan includes it.`;
    return `Request opened: "${input.title}" (status QUEUED).`;
  }
  if (name === 'escalate_to_team') return 'The team has been alerted.';
  return `Unknown tool ${name}`;
}

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
async function converse(messages, called) {
  for (let turn = 0; turn < 6; turn++) {
    const res = await client.messages.create({ model: MODEL, max_tokens: 4000, cache_control: { type: 'ephemeral' }, output_config: { effort: 'low' }, system: systemPrompt('Kabir'), tools: TOOLS, messages });
    usage.input += res.usage.input_tokens; usage.output += res.usage.output_tokens;
    usage.cacheRead += res.usage.cache_read_input_tokens ?? 0; usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;
    if (res.stop_reason === 'refusal') return { text: '', refused: true };
    const calls = res.content.filter((b) => b.type === 'tool_use');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!calls.length || res.stop_reason !== 'tool_use') return { text };
    messages.push({ role: 'assistant', content: res.content });
    messages.push({ role: 'user', content: calls.map((c) => { called.push(c.name); return { type: 'tool_result', tool_use_id: c.id, content: fakeTool(c.name, c.input) }; }) });
  }
  return { text: '' };
}

const guardCtx = { ownGstin: '24ABCDE1234F1Z5', ownEmails: [], otherClientNames: ['Zoya Traders Pvt Ltd', 'Tara Traders Pvt Ltd'] };
const results = [];
for (const s of scenarios) {
  const called = [];
  const messages = build(s);
  let { text, refused } = await converse(messages, called);
  const draftViolations = text ? checkOutput(text, guardCtx) : [];
  if (draftViolations.length) { // same one-rewrite policy as production
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: `<guardrail>${rewriteNote(draftViolations)}</guardrail>` });
    ({ text, refused } = await converse(messages, called));
  }
  const e = s.expect ?? {};
  const fails = [];
  if (refused) fails.push('refused');
  if (!text && !refused) fails.push('empty reply');
  for (const t of e.tools ?? []) if (!called.includes(t)) fails.push(`expected tool ${t}`);
  if (e.noTools === true && called.length) fails.push(`unexpected tools ${called.join(',')}`);
  if (Array.isArray(e.noTools)) for (const t of e.noTools) if (called.includes(t)) fails.push(`must not call ${t}`);
  for (const r of e.mustMatch ?? []) if (!new RegExp(r, 'i').test(text)) fails.push(`missing /${r}/`);
  for (const r of e.mustNotMatch ?? []) if (new RegExp(r, 'i').test(text)) fails.push(`contains /${r}/`);
  const finalViolations = text ? checkOutput(text, guardCtx) : [];
  if (finalViolations.length) fails.push(`guardrail: ${finalViolations.join(',')}`);
  if (e.maxChars && text.length > e.maxChars) fails.push(`too long (${text.length})`);
  results.push({ id: s.id, category: s.category, pass: fails.length === 0, fails, tools: called, rewritten: draftViolations.length > 0, reply: text });
  console.log(`${fails.length ? '✗' : '✓'} ${s.id.padEnd(11)} ${fails.join('; ')}`);
}

const passed = results.filter((r) => r.pass).length;
const score = results.length ? passed / results.length : 0;
const byCat = {};
for (const r of results) { byCat[r.category] ??= { pass: 0, total: 0 }; byCat[r.category].total++; if (r.pass) byCat[r.category].pass++; }
const costUsd = (usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheRead * PRICE.cacheRead + usage.cacheWrite * PRICE.cacheWrite) / 1e6;
console.log(`\nScore ${passed}/${results.length} (${(score * 100).toFixed(1)}%) · model ${MODEL} · ~$${costUsd.toFixed(4)}`);
for (const [c, v] of Object.entries(byCat)) console.log(`  ${c.padEnd(12)} ${v.pass}/${v.total}`);
const out = join(here, 'results');
mkdirSync(out, { recursive: true });
const file = join(out, `manager-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ model: MODEL, score, passed, total: results.length, byCategory: byCat, usage, costUsd, results }, null, 2));
console.log(`Report: ${file}`);
if (score < min) process.exit(1);
