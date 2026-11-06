# SOLLUNA 2.0 production image. Build context: repository root (needs .claude/skills — the API refuses to boot without them).
#   docker build -f platform/deploy/Dockerfile --target api -t solluna-api .
#   docker build -f platform/deploy/Dockerfile --target web -t solluna-web .
# Full bookworm image: ships openssl + CA certificates that Prisma needs (no apt step).
FROM node:22-bookworm AS deps
WORKDIR /app/platform
COPY platform/package.json platform/package-lock.json ./
COPY platform/apps/api/package.json apps/api/
COPY platform/apps/web/package.json apps/web/
# Optional build secret "ca": extra CA bundle for build hosts behind a TLS-inspecting proxy. Unused on normal servers.
RUN --mount=type=secret,id=ca,required=false sh -c '[ -f /run/secrets/ca ] && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; npm ci --no-audit --no-fund'

FROM deps AS build
COPY platform/ ./
RUN --mount=type=secret,id=ca,required=false sh -c '[ -f /run/secrets/ca ] && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; npx prisma generate --schema apps/api/prisma/schema.prisma && npm run build -w @solluna/api && npm run build -w @solluna/web'

# ── API: NestJS + Prisma. Applies pending migrations (additive; never resets data) before starting.
FROM node:22-bookworm AS api
ENV NODE_ENV=production
WORKDIR /app/platform
COPY --from=build /app/platform/node_modules ./node_modules
COPY --from=build /app/platform/package.json ./
COPY --from=build /app/platform/apps/api/dist ./apps/api/dist
COPY --from=build /app/platform/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/platform/apps/api/package.json ./apps/api/
COPY --from=build /app/platform/packages ./packages
COPY .claude/skills /app/.claude/skills
ENV SKILLS_DIR=/app/.claude/skills PORT=4000
USER node
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/apps/api/src/main.js"]

# ── Web: Next.js server (public site + dashboards); proxies /api to the API at runtime (API_URL).
FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production
WORKDIR /app/platform
COPY --from=build /app/platform/node_modules ./node_modules
COPY --from=build /app/platform/package.json ./
COPY --from=build /app/platform/apps/web ./apps/web
USER node
WORKDIR /app/platform/apps/web
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
