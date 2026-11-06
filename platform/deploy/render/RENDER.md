# SOLLUNA 2.0 — Temporary Render preview (testing only, not production)

| | |
|---|---|
| **Preview URL** | https://solluna-preview.onrender.com |
| API (direct) | https://solluna-api-preview.onrender.com/api/health |
| Branch | `solluna-2.0-platform` (manual deploys; see "Deploying a change") |
| Region | Singapore (closest free region to India) |
| Database | Render Postgres 16, free — **expires 6 Dec 2026** |
| Payments | Razorpay **not configured**: checkout returns "payments not configured" and writes nothing |
| Email | No connector: password-reset and verification emails are not sent (in-app notifications work) |

solluna.co.in, its DNS, the GitHub Pages site and the `main` branch are untouched by this preview.

## Services
| Render service | Type | Build | Start |
|---|---|---|---|
| `solluna-preview` | Free web service running **web + API together** | `cd platform && npm ci --include=dev && prisma generate && build api && build web` | `bash platform/deploy/render/start-preview.sh` |
| `solluna-api-preview` | Former separate API service — **suspended** (kept only for rollback) | — | — |
| `solluna-preview-db` | Free Postgres | — | internal URL only (no public IP allow-list) |

Why one service: two free services sleep separately (first request ~60–90 s) and two always-on services would need ~1,440 hours a month, far above the 750 free hours. One service stays within the free hours, so `KEEP_ALIVE_URL` makes the API ping its own public URL every 10 minutes and the preview never sleeps.

`start-preview.sh` runs `prisma migrate deploy`, then the API on `127.0.0.1:4000` and Next.js on Render's `$PORT` (Next proxies `/api`). Node heaps are capped to fit 512 MB. Seeds run only with `RUN_SEEDS=1` (needed only for a fresh database).
Secrets (`JWT_SECRET`, `DATA_ENCRYPTION_KEY`, `ADMIN_PASSWORD`, `DATABASE_URL`) are Render environment variables, generated randomly for this preview and never committed.

Preview-only settings: `PREVIEW_MODE=true` (enables the no-payment test activation button), `PREVIEW_DEMO_SUBSCRIPTIONS`, `PREVIEW_BANNER` (amber banner + `noindex`), `KEEP_ALIVE_URL`, `TRUST_PROXY_HOPS=1`, `AUTH_RATE_LIMIT_PER_MIN=20`. Manager hand-off timing: `MANAGER_ASSIGN_DELAY_MIN` (default 5), `MANAGER_MESSAGE_GAP_SEC` (default 40).

## Demo data
Accounts (passwords are held privately by the owner, not in the repository):

| Role | Account | What to test |
|---|---|---|
| Super admin (2FA) | `admin@demo.solluna.co.in` | Admin console: MRR, clients, plans editor, enquiries, audit log |
| Operations manager | `kabir@demo.solluna.co.in` | Task queue, client workspaces, labels upload, listing status, tickets |
| Accounts | `meera@demo.solluna.co.in` | Monthly report data entry, report publishing, CA documents |
| Ads manager | `rohan@demo.solluna.co.in` | Ads task with budget approval |
| Listing executive | `isha@demo.solluna.co.in` | Listing lifecycle, catalog mapping |
| Support | `neha@demo.solluna.co.in` | Ticket handling, internal notes |
| Client — Growth (Gujarat, CGST+SGST) | `riya@demo.solluna.co.in` | Listings, mapping, ads approval, labels, low stock, reports, tickets, chat |
| Client — Reseller (Maharashtra, IGST) | `amit@demo.solluna.co.in` | Plan limits: ads out of plan, no labels |
| Client — Premium (Karnataka, IGST) | `kavya@demo.solluna.co.in` | Thank-you note design approval, labels with inserts |

**Demo plans are not payments.** `apps/api/prisma/seed-preview.ts` gives the three demo clients an ACTIVE plan for 30 days with no Payment row and no invoice, and records `preview.demo_subscription` in the audit log. It runs only with `PREVIEW_MODE=true`, refuses any `APP_URL` on solluna.co.in, and only touches `@demo.solluna.co.in` accounts.

Re-seeding a fresh database:
```bash
cd platform
ADMIN_EMAIL=admin@demo.solluna.co.in ADMIN_PASSWORD=… STAFF_PASSWORD=… CLIENT_PASSWORD=… node deploy/render/seed-demo.mjs https://solluna-preview.onrender.com accounts
# restart the API service (Render dashboard → Manual Deploy → Restart), then:
ADMIN_TOTP_SECRET=… (same env) node deploy/render/seed-demo.mjs https://solluna-preview.onrender.com workflows
```

## Tests
```bash
cd platform
node deploy/verify-production.mjs https://solluna-preview.onrender.com --write        # 28 deployment checks
node deploy/render/test-preview.mjs https://solluna-preview.onrender.com ./shots     # 27 role, workflow and permission checks
```
Both need ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_TOTP_SECRET (and STAFF_PASSWORD / CLIENT_PASSWORD for the second).

## Deploying a change
The Render GitHub app is not installed, so pushes do not auto-deploy. After pushing to `solluna-2.0-platform`, open `solluna-preview` in the Render dashboard → **Manual Deploy → Deploy latest commit**. To enable auto-deploy, install the Render GitHub app for this repository and switch Auto-Deploy on.

## Free-tier limitations (why this is not production)
1. **Kept awake by a self-ping** every 10 minutes (one service ≈ 744 hours/month, within the 750 free hours). After a deploy or restart the first request can still take ~30–60 seconds; the browser retries for up to 90 seconds.
2. **Database expires on 6 Dec 2026** (30 days), then it is deleted after a grace period. 1 GB storage, **no backups, no point-in-time recovery.** Treat every record as disposable.
3. **512 MB RAM, 0.1 CPU** per service: pages and label downloads are noticeably slower than on a real server; no load testing here.
4. **750 free instance hours per month** per workspace. The always-on preview uses ~720–744. Do not start other free services in this workspace, or the preview may be suspended near month-end.
5. **No background worker, cron job, shell or persistent disk** on free services. Files are stored in Postgres, so nothing is lost on restart, but anything stored dies with the database.
6. **No email delivery** until a connector webhook is configured (`CONNECTOR_WEBHOOK_URL`). Forgot-password and verification links therefore do not arrive; signed-in users can still change their password in Settings.
7. **onrender.com domain, Singapore region.** Data is outside India and the address is not the brand domain. Do not put real client data or credentials into the preview.
8. Builds can take 5–10 minutes on the free build pipeline.

## Moving to DigitalOcean later (production)
The production package is already in `platform/deploy/` (Docker, Caddy HTTPS, nightly backups); follow `platform/deploy/DEPLOY.md`. Summary:
1. Create a Droplet: Ubuntu 24.04, 2 vCPU / 4 GB, **Bangalore (BLR1)**, with automatic backups on. Firewall 22 (your IP), 80, 443.
2. Install Docker, clone the repository, check out the release commit (the one tested on this preview).
3. Create `platform/deploy/.env.production` from the example with **new** secrets. Do not reuse the preview's secrets or passwords. Set `APP_URL=https://solluna.co.in`, leave `PREVIEW_MODE` / `PREVIEW_BANNER` unset, set `REQUIRE_ADMIN_2FA=true`, and leave Razorpay empty until KYC.
4. `docker compose … up -d --build`, then seed plans and the real super admin once (`seed-plans.ts`). **Do not run `deploy/render/seed-demo.mjs` in production;** the demo seed also refuses solluna.co.in.
5. Run `verify-production.mjs` against the server, then switch DNS (A `@` → droplet IP, CNAME `www`). Rollback = restore the GitHub Pages A records.
6. Preview data is not migrated: it is demo data. Delete the Render services and database once production is verified.
