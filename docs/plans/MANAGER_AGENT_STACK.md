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
| 7a | **Pipelines** (owner's step-by-step flows) | ✅ Seller Account Registration: existing account → admin access; no account → list → sign-up (mobile, email, password) → OTP relay → business details → team opens → admin access → password change. Manager sees only the current step; server refuses other steps' fields and team steps · ✅ Brand Approval (Flipkart): brand + FSN + document type → upload + requirement checks → team applies (request ID) → Flipkart decision → result. ✅ Brand Approval (Amazon India): brand + ASIN + client phone → invoice(s) checked against Amazon's 180-day / 100-unit rules → team "Apply to sell" (email = SOLLUNA, phone = client, all boxes ticked) → decision → result · ✅ Catalog Mapping (Flipkart + Amazon): client submits the Mapping form (server-checked) → team maps (SKU / listing IDs) → LIVE / ISSUE → result · ✅ New Listing (Flipkart + Amazon): form (server-checked) → team pastes keywordtool.io top 100 (deduped; Amazon search terms ≤ 250 bytes) → team creates → QC → result · ✅ Marketplace Support (Flipkart + Amazon): issue → team raises ticket (ID) → reply RESOLVED / NEEDS_INFO / CLOSED → client update; NEEDS_INFO loops back on the same ticket · ✅ CA Documents (monthly, opened on the 5th per marketplace): team uploads Flipkart GSTR / Sales / TDS and Amazon MTR B2B / B2C / fee invoices for the month → manager tells the client unprompted · ✅ Proactive updates: when the team finishes a step, the manager messages the client | `apps/api/src/chat/pipelines.ts`, `pipeline.service.ts` |
| 7 | Cache + Router | ✅ Prompt caching · ⏳ rule router from the owner's pipeline (deterministic answers / which skill + tools per intent) | — |
| 8 | Observability + Evals | ✅ Rolling chat summary keeps long chats cheap · ✅ Per reply: tokens, cost, tools used, input flags, guardrail result, rewrite/fallback, latency (`AgentRun.trace`) · ✅ 43-scenario eval set + runner · ⏳ trace view in admin | `apps/api/evals/` |

## Outside projects reviewed (8 Nov 2026)
| Project | Decision | Why |
|---|---|---|
| petergyang/no-ai-slop (MIT) | ✅ **Used** — writing-style rules in the prompt + soft `ai_slop` guardrail (rewrite once, never blocks) | Fits "never sound like AI": filler words, "it's not X, it's Y", "Great question", em dashes |
| thedotmack/claude-mem (Apache-2.0) | ✅ **Idea used** — rolling `chat_summary` per client; only summary + last 16 messages go to the model | Plugin itself is for coding agents on a laptop (local worker, telemetry on by default) and would mix clients' data — not installed |
| mksglu/context-mode (ELv2) | ✅ **Idea used** — tools return short results, full data stays in the database | Plugin is for coding agents; ELv2 forbids offering it as a hosted service — not installed |
| Panniantong/Agent-Reach (MIT) | ❌ Not added | Reads X / Reddit / YouTube / Chinese sites, partly with copied browser logins; nothing for Amazon / Flipkart work, and login-cookie scraping is against our rules. Possible later for the owner's research agent (YouTube / Reddit trends) |
| open-gsd/gsd-core (MIT) | ❌ Not added to the manager | A plan → execute → verify workflow for coding agents that build software. Our orchestrator already runs client work as tasks with evidence-based completion. Could be used to build the platform itself |

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
