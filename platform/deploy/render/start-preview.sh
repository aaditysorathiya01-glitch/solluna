#!/usr/bin/env bash
# Render preview: web (Next.js) and API (NestJS) in ONE free service, so it can stay awake within the
# 750 free hours/month. Render's $PORT goes to Next.js; the API listens on 127.0.0.1:4000 behind the /api proxy.
set -euo pipefail
cd "$(dirname "$0")/../.."
WEB_PORT="${PORT:-3000}"
node node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma
PORT=4000 node apps/api/dist/apps/api/src/main.js &
(cd apps/web && PORT="$WEB_PORT" API_URL=http://127.0.0.1:4000 node ../../node_modules/next/dist/bin/next start -p "$WEB_PORT" -H 0.0.0.0) &
# Idempotent seeds run after both servers are up, so they never delay the first request.
(sleep 20; node node_modules/tsx/dist/cli.mjs apps/api/prisma/seed-plans.ts && node node_modules/tsx/dist/cli.mjs apps/api/prisma/seed-preview.ts) &
# If either server exits, stop the container so Render restarts it.
wait -n
exit 1
