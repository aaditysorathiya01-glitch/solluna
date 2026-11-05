# SOLLUNA 2.0 Platform

Amazon & Flipkart marketplace-management SaaS. Repo rules: `../CLAUDE.md` · Build plan: `../docs/plans/SOLLUNA_PLATFORM_PLAN.md`

| Part | Path | Stack |
|---|---|---|
| API | `apps/api` | NestJS 11, Prisma 5, PostgreSQL |
| Web | `apps/web` | Next.js 15 (App Router), Tailwind 3.4 |
| Shared rules | `packages/permissions` | 28-feature catalog → skills, roles, connectors, entitlement check |
| Skills | `../.claude/skills` | 1 orchestrator + 28 specialist procedures (loaded by the API at boot) |

## Run locally
```bash
cp .env.example .env            # fill JWT_SECRET, Razorpay test keys, ADMIN_*
docker compose up -d            # Postgres + Redis
npm install
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm run db:seed                 # plans × 28 features + first super admin
npm run dev:api                 # :4000
npm run dev:web                 # :3000  (proxies /api → API_URL)
```

## Test
```bash
npm test     # skill-map drift check + 18 API E2E + 6 browser E2E (needs local Postgres)
```

## What is built (tested end-to-end)
- **Auth:** customer registration (org + Manager Chat conversation), login, httpOnly session, staff roles, instant revocation, per-IP brute-force limit, audit log.
- **Billing:** Razorpay Orders (REST), Checkout signature + webhook HMAC verification, idempotent activation, GST-inclusive invoices, failed-payment handling, plan switch, renewal reminder → grace → past due.
- **Features ↔ skills:** all 28 services served with their skill and connectors. The API refuses to boot if a skill is missing. Plan limits are read from the DB.
- **Orchestrator:** workflow graphs from the orchestrator skill (new listing, replenishment, advertising, promotion, shipping labels, monthly reporting, single-step). Covers dependency propagation, skip rules, client approval gates, evidence-gated completion, quota reservation under a per-org lock, and client updates in the orchestrator's format.
- **Connectors:** in-app notifications + HMAC-signed webhook for Zapier fan-out; Drive/Docs links enforced as delivery channels.
- **Web:** landing + live pricing, register/login, customer dashboard (overview, services, requests, approvals, billing with Razorpay Checkout), staff ops console (role-scoped queue, skill procedure, evidence form).

## Not built yet
Manager Chat (real-time), file uploads to S3/R2, document/report modules, marketplace APIs (SP-API, Flipkart), manager-to-client assignment scoping, email/mobile OTP verification, admin 2FA, admin UI for editing plan limits (DB-ready; no screen yet).
