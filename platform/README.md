# SOLLUNA 2.0 Platform

Amazon & Flipkart marketplace-management SaaS. Repo context and rules: `../CLAUDE.md`.

- Build plan: `../docs/plans/SOLLUNA_PLATFORM_PLAN.md`
- Plan matrix (source of truth): `../docs/plans/SOLLUNA_Marketplace_Management_Plans.txt`
- Service skills: `../.claude/skills/` (orchestrator: `solluna-skill-orchestrator`)
- Feature catalog (28 keys → skills): `packages/permissions/src/features.ts`
- Schema: `apps/api/prisma/schema.prisma`

## Setup
```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate -- --name init
npm run db:seed
npm run verify:skills
```
