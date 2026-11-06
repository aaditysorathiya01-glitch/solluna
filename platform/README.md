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
npm test     # skill-map drift check + 11 engine unit + 36 API E2E + 14 browser E2E (needs local Postgres)
```

## What is built (tested end-to-end)
- **Auth:** customer registration (org + Manager Chat conversation), login, httpOnly session, staff roles, instant revocation, per-IP brute-force limit, audit log.
- **Billing:** Razorpay Orders (REST), Checkout signature + webhook HMAC verification, idempotent activation, **GST-exclusive pricing with GST tax invoices** (CGST+SGST intra-state / IGST inter-state, place of supply from GSTIN or billing state, GSTIN check-digit validation, gap-free `SOL/26-27/00001` numbering per FY, amount in words, printable PDF), failed-payment handling, plan switch, renewal reminder → grace → past due.
- **Features ↔ skills:** all 28 services served with their skill and connectors. The API refuses to boot if a skill is missing. Plan limits are read from the DB.
- **Orchestrator:** workflow graphs from the orchestrator skill (new listing, replenishment, advertising, promotion, shipping labels, monthly reporting, single-step). Covers dependency propagation, skip rules, client approval gates, evidence-gated completion, quota reservation under a per-org lock, and client updates in the orchestrator's format.
- **Connectors:** in-app notifications + HMAC-signed webhook for Zapier fan-out; Drive/Docs links enforced as delivery channels.
- **Manager Chat Support:** one private conversation per client, live both ways (Server-Sent Events, no extra dependency), attachments, read receipts, search, staff-only internal notes, manager auto-assignment at registration + reassignment, staff inbox with waiting time, log a request from chat through the orchestrator (plan rules apply), notifications in-app and via the Zapier connector.
- **Documents:** uploads checked by file content (PDF, images, XLSX, DOCX, CSV, TXT only; executables/HTML/macro files rejected), 10 MB limit, client vs internal visibility, tenant isolation, SHA-256 integrity check on download, staff downloads audited; a shared document counts as task delivery evidence. Stored in Postgres for the MVP behind `StorageService` (swap for S3/R2 later).
- **Monthly reporting (skills: monthly-pl-report, monthly-business-performance-report, ca-documentation-support):** staff enter monthly Amazon/Flipkart figures and SKU lines from marketplace reports; clients enter effective-dated product costs and monthly expenses and confirm them. A pure engine (`apps/api/src/reports/engine.ts`) builds the P&L (sections A–G, Amazon/Flipkart separate + consolidated), KPIs with month-on-month change, product-wise profitability, settlement-to-bank reconciliation, anomalies with evidence, assumptions register and action plan. Every figure carries VERIFIED / ESTIMATED / UNAVAILABLE: no product profit without client costs, "excludes advertising" when ad spend is missing, partial operating result until expenses are confirmed, no "received" settlement without a bank credit. Draft → publish (client sees published only, notified), versioned, CSV export and print/PDF. CA pack: document index, missing tracker, CA-review flags.
- **Account security:** password reset and email verification by emailed single-use links (only SHA-256 hashes stored; delivered through the Zapier connector), change password (ends other sessions), mandatory TOTP 2FA for super admins (AES-256-GCM encrypted seed; enrolment screen before the console opens), optional 2FA for everyone, profile and business details, terms consent at sign-up.
- **Support tickets:** plan §14 lifecycle (New → Assigned → In progress → Waiting for client/marketplace → Resolved → Closed), SLA due times by priority, staff-only internal notes, client reply re-opens work, client close/reopen, notifications on every status change.
- **Onboarding & catalog:** onboarding checklist; Amazon/Flipkart seller details (password fields rejected outright) with CONNECTED only on staff-recorded evidence; products; new listings submitted per marketplace through the orchestrator (plan + monthly quota), tracked separately with the skills' status vocabularies, ASIN/FSN + live URL required for live; existing-catalog mapping with confidence results.
- **Labels & thank-you notes:** label batches (Growth+) delivered byte-for-byte unaltered and marked delivered on download; Premium thank-you designs with a marketplace-policy wording guard, client approval, versioning, and an exact-size print sheet as separate inserts.
- **Low stock:** inventory snapshots with low-stock-alerts §7 severities (velocity never guessed), stale-data flag, client + manager alerts, acknowledgements (Growth+).
- **Admin console:** KPIs (MRR, collections, overdue P1, blocked tasks), clients (detail, manager assignment, instant suspension), team (roles, disable, 2FA reset, last-admin guard), plan prices and limits editor enforced by the API, payments with invoices, audit log, website enquiries, announcements; cancel-at-period-end for clients.
- **Public website:** home, services (from the live plan matrix), about, FAQ, contact form (honeypot + rate limit → admin inbox), Terms, Privacy (DPDP Act), Refund & Cancellation.
- **Web:** landing + live pricing, register/login, customer dashboard (overview, services, requests, approvals, billing with Razorpay Checkout), staff ops console (role-scoped queue, skill procedure, evidence form).

## Not built yet
Automatic import of marketplace reports (figures are entered by staff until SP-API / Flipkart API access is approved), Virus scanning of uploads (files are marked NOT_SCANNED until a scanner such as ClamAV is added), S3/R2 storage driver, multi-instance live chat (needs Redis pub/sub), marketplace APIs (SP-API, Flipkart), mobile OTP verification, QR codes on thank-you notes (website printed as text), refunds through Razorpay (manual per policy).
