# Client manager agent — 8-layer stack

Owner's structure (8 Nov 2026). Model: **Claude Haiku 5.5 only**. No stronger model: the owner's pipeline will say where each kind of work goes, and the router follows it. No message limits yet; cost per client is in Admin → Manager cost.

| # | Layer | Status | Where |
|---|---|---|---|
| 1 | LLM API call | ✅ Background runs, tool loop, refusal → escalate, failure → team alert | `apps/api/src/chat/manager-agent.service.ts` |
| 2 | System prompt | ✅ Persona, scope, onboarding, hard rules · ⏳ split into stable + plan + client stage | `apps/api/src/chat/manager-prompt.ts` |
| 3 | RAG | ⏳ Next: skills + client documents/chats, retrieved per message, tenant-scoped | — |
| 4 | Tools (MCP-shaped registry) | ✅ remember, set_seller_account, create_service_request, escalate_to_team · ⏳ read tools (plan, listings, labels, reports, approvals, tickets) | `manager-prompt.ts` (definitions), service `useTool` |
| 5 | RBAC + OAuth | ✅ Tools bound to the client on the server; the model never chooses a client · ⏳ per-tool role list (client manager / CEO agent / staff); marketplace OAuth tokens in the encrypted credential store | — |
| 6 | Guardrails | ✅ **Input:** passwords/OTPs/PINs masked before the model; injection and cross-client attempts flagged. **Output:** AI disclosure, claiming to be human, asking for secrets, guarantees, other clients' identifiers, outside links, internal leaks, length → rewritten once, then safe hand-off + team alert | `apps/api/src/chat/guardrails.ts` |
| 7 | Cache + Router | ✅ Prompt caching · ⏳ rule router from the owner's pipeline (deterministic answers / which skill + tools per intent) | — |
| 8 | Observability + Evals | ✅ Per reply: tokens, cost, tools used, input flags, guardrail result, rewrite/fallback, latency (`AgentRun.trace`) · ✅ 41-scenario eval set + runner · ⏳ trace view in admin | `apps/api/evals/` |

## Evals
```bash
cd platform && npm run build -w @solluna/api
ANTHROPIC_API_KEY=… node apps/api/evals/run-manager-evals.mjs            # full run, a few US cents on Haiku
node apps/api/evals/run-manager-evals.mjs --only id-01,sec-01            # some scenarios
node apps/api/evals/run-manager-evals.mjs --min 0.9                      # fail below 90 %
```
Categories: onboarding, language, off-topic, injection, identity, secrets, plan, approvals, escalation, guarantees, operations, style. Reports go to `apps/api/evals/results/` (not committed). Add a scenario whenever a real chat goes wrong. Expected before RAG: report-date and label questions fail (the knowledge is not in the prompt yet) — that is what layer 3 fixes.

## Rules that never change
- Never says "AI"; never claims to be human when sincerely asked.
- Never asks for or stores passwords / OTPs; never marks a seller account connected.
- Plan checks, approvals and tenant isolation are enforced by the server, not by the prompt.
