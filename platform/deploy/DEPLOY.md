# SOLLUNA 2.0 — Production deployment runbook

Stack: **Caddy** (automatic Let's Encrypt HTTPS) → **web** (Next.js) → **api** (NestJS) → **Postgres 16**, plus a nightly **pg_dump** job.
Everything runs from `platform/deploy/docker-compose.prod.yml` on one Linux server.

## 0. Current live site (rollback target)
- solluna.co.in is today a static GitHub Pages site from `main` (`index.html`, `style.css`, `script.js`, `images/`, `CNAME`). It has no database.
- Backup: branch **`backup/live-site-2026-11-06`** = exact copy of `main` @ `d0ae0a1`. `main` itself is not modified by this deployment.
- Rollback = point DNS back to GitHub Pages (step 6). Nothing on GitHub needs to change.

## 1. Server
- Ubuntu 24.04 LTS, 2 vCPU / 4 GB RAM / 60 GB SSD. India region recommended (Mumbai / Bengaluru).
- Firewall: allow 22 (your IP only), 80, 443.
- Install Docker Engine + compose plugin (`curl -fsSL https://get.docker.com | sh`).
- Enable the provider's automatic daily snapshots (second backup layer).

## 2. Code
```bash
git clone https://github.com/aaditysorathiya01-glitch/solluna.git /opt/solluna
cd /opt/solluna && git checkout solluna-2.0-platform
```

## 3. Secrets
```bash
cp platform/deploy/.env.production.example platform/deploy/.env.production
chmod 600 platform/deploy/.env.production
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # DATA_ENCRYPTION_KEY (store an offline copy)
```
Fill `ADMIN_PASSWORD` (16+ chars). Leave the Razorpay keys empty until KYC is complete: checkout then shows "payments not configured", and nothing is simulated.

## 4. Start (before DNS) and seed once
```bash
docker compose -f platform/deploy/docker-compose.prod.yml --env-file platform/deploy/.env.production up -d --build
docker compose -f platform/deploy/docker-compose.prod.yml --env-file platform/deploy/.env.production run --rm --no-deps api npx tsx apps/api/prisma/seed-plans.ts
curl -s http://127.0.0.1/ -H 'Host: solluna.co.in' -o /dev/null -w '%{http_code}\n'   # 308 → https (expected before DNS)
```
Migrations run automatically on every API start (`prisma migrate deploy`). They only apply new migrations and never reset data.

## 5. DNS cutover (at the domain registrar)
| Record | Name | Value |
|---|---|---|
| A | `@` (solluna.co.in) | server IPv4 |
| CNAME | `www` | `solluna.co.in` |

Remove the four GitHub Pages A records (185.199.108–111.153) for `@`. Lower the TTL to 300 a day before the change. Caddy issues the certificates automatically within about a minute of DNS resolving.

## 6. Rollback (under 5 minutes plus DNS TTL)
Put the GitHub Pages A records back: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`. The old site is served again from `main`, unchanged.

## 7. Verify (from any machine with Node + Playwright)
```bash
cd platform && node deploy/verify-production.mjs https://solluna.co.in            # read-only
node deploy/verify-production.mjs https://solluna.co.in --write                    # + one labelled test client
```
Then sign in as the super admin, enrol 2FA (Google Authenticator → enter setup key), and confirm the Admin console opens.

## 8. Operations
- **Update:** `git pull && docker compose ... up -d --build` (migrations apply on start).
- **Backups:** `docker compose ... exec backup ls /backups`. Copy dumps off the server weekly (e.g. to Google Drive).
- **Restore:** `pg_restore -h postgres -U solluna -d <db> /backups/<file>.dump`. A drill was tested on 6 Nov 2026 and restored all tables.
- **Logs:** `docker compose ... logs -f api web caddy`.
