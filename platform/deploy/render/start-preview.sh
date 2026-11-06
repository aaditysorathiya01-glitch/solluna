#!/usr/bin/env bash
# Render preview: web (Next.js) and API (NestJS) in ONE free service, so it can stay awake within the
# 750 free hours/month. Render's $PORT goes to Next.js; the API listens on 127.0.0.1:4000 behind the /api proxy.
set -euo pipefail
cd "$(dirname "$0")/../.."
WEB_PORT="${PORT:-3000}"
node node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma
# 512 MB instance: cap each Node heap so the two servers fit together.
PORT=4000 node --max-old-space-size=180 apps/api/dist/apps/api/src/main.js &
(cd apps/web && PORT="$WEB_PORT" API_URL=http://127.0.0.1:4000 node --max-old-space-size=200 ../../node_modules/next/dist/bin/next start -p "$WEB_PORT" -H 0.0.0.0) &
# Seeds are idempotent but heavy (tsx); run them only when asked (RUN_SEEDS=1), e.g. on a fresh database.
if [ "${RUN_SEEDS:-0}" = "1" ]; then
  (sleep 30; node --max-old-space-size=120 node_modules/tsx/dist/cli.mjs apps/api/prisma/seed-plans.ts && node --max-old-space-size=120 node_modules/tsx/dist/cli.mjs apps/api/prisma/seed-preview.ts) &
fi
# If either server exits, stop the container so Render restarts it.
wait -n
exit 1
