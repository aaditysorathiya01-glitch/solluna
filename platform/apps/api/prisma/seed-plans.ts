import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { FEATURES, FEATURE_KEYS, PLANS, type PlanCode } from '../../../packages/permissions/src/features';

const prisma = new PrismaClient();

/** Idempotent: creates plans/features if missing, never overwrites admin edits. */
async function main() {
  for (const code of Object.keys(PLANS) as PlanCode[]) {
    const def = PLANS[code];
    const plan = await prisma.plan.upsert({
      where: { code },
      update: {},
      create: { code, name: def.name, pricePaise: def.pricePaise, sortOrder: def.sortOrder },
    });
    for (const featureKey of FEATURE_KEYS) {
      const f = FEATURES[featureKey].plans[code] as { enabled: boolean; limit?: number | null; meta?: object };
      await prisma.planFeature.upsert({
        where: { planId_featureKey: { planId: plan.id, featureKey } },
        update: {},
        create: { planId: plan.id, featureKey, enabled: f.enabled, limitValue: f.limit ?? null, meta: f.meta ?? undefined },
      });
    }
  }
  // First super admin, from env (never hard-coded). Skipped if unset or already present.
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      await prisma.user.create({ data: { type: 'STAFF', staffRole: 'SUPER_ADMIN', email, name: process.env.ADMIN_NAME ?? 'SOLLUNA Admin', passwordHash: await bcrypt.hash(password, 12) } });
      console.log(`Created super admin ${email}`);
    }
  }
  console.log(`Seeded ${Object.keys(PLANS).length} plans × ${FEATURE_KEYS.length} features.`);
}

main().finally(() => prisma.$disconnect());
