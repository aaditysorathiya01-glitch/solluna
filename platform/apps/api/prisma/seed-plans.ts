import { PrismaClient } from '@prisma/client';
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
  console.log(`Seeded ${Object.keys(PLANS).length} plans × ${FEATURE_KEYS.length} features.`);
}

main().finally(() => prisma.$disconnect());
