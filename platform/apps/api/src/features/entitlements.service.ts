import { Injectable } from '@nestjs/common';
import { Prisma, Subscription } from '@prisma/client';
import { FEATURES, FEATURE_KEYS, type FeatureKey, type PlanCode } from '../../../../packages/permissions/src/features';
import { checkEntitlement, type EntitlementContext, type EntitlementResult } from '../../../../packages/permissions/src/entitlements';
import { FEATURE_CONNECTORS } from '../../../../packages/permissions/src/connectors';
import { PrismaService } from '../common/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;
/**
 * Quotas are "per billing month" (T&C 4). Subscription.currentPeriodStart is the billing anchor; the
 * current billing month is anchor + k months, the latest such date ≤ now. Early renewals extend
 * currentPeriodEnd without moving the anchor, so quotas still reset monthly.
 */
export function billingMonthStart(anchor: Date, now = new Date()): Date {
  let k = (now.getFullYear() - anchor.getFullYear()) * 12 + (now.getMonth() - anchor.getMonth());
  const at = (n: number) => { const d = new Date(anchor); d.setMonth(d.getMonth() + n); return d; };
  if (at(k) > now) k--;
  return at(Math.max(k, 0));
}

const OPEN_STATUSES = ['COMPLETED', 'CANCELLED', 'PARTIALLY_COMPLETED'] as const;

export interface OrgEntitlements {
  ctx: EntitlementContext;
  subscription: (Subscription & { plan: { code: string; name: string } }) | null;
  periodStart: Date | null;
}

@Injectable()
export class EntitlementsService {
  constructor(private readonly db: PrismaService) {}

  /** The subscription that currently grants service: ACTIVE, or GRACE_PERIOD before graceUntil. */
  async currentSubscription(orgId: string, db: Db = this.db) {
    return db.subscription.findFirst({
      where: { organizationId: orgId, status: { in: ['ACTIVE', 'GRACE_PERIOD'] } },
      include: { plan: { select: { code: true, name: true } } },
      orderBy: { currentPeriodEnd: 'desc' },
    });
  }

  async context(orgId: string, db: Db = this.db): Promise<OrgEntitlements> {
    const sub = await this.currentSubscription(orgId, db);
    if (!sub) {
      // A payment in flight means the plan cannot be verified yet (orchestrator: Pending Verification).
      const inFlight = await db.payment.findFirst({ where: { organizationId: orgId, status: 'INITIATED', createdAt: { gte: new Date(Date.now() - 30 * 60_000) } } });
      return { ctx: { subscriptionActive: inFlight ? null : false, features: new Map(), usage: new Map() }, subscription: null, periodStart: null };
    }
    const planFeatures = await db.planFeature.findMany({ where: { planId: sub.planId } });
    const features = new Map(planFeatures.map((f) => [f.featureKey as FeatureKey, { enabled: f.enabled, limitValue: f.limitValue }]));
    const periodStart = billingMonthStart(sub.currentPeriodStart!);

    // Metered usage = completed quota consumption + requests still in flight this period (reservations),
    // so parallel requests cannot over-commit a monthly allowance.
    const usage = new Map<FeatureKey, number>();
    for (const key of FEATURE_KEYS.filter((k) => (FEATURES[k] as { metered?: boolean }).metered)) {
      const counter = await db.usageCounter.findUnique({ where: { organizationId_featureKey_periodStart: { organizationId: orgId, featureKey: key, periodStart } } });
      const inFlight = await db.serviceRequest.count({
        where: { organizationId: orgId, featureKey: key, entitlement: 'ALLOWED', createdAt: { gte: periodStart }, status: { notIn: [...OPEN_STATUSES] } },
      });
      usage.set(key, (counter?.used ?? 0) + inFlight);
    }
    return { ctx: { subscriptionActive: true, features, usage }, subscription: sub, periodStart };
  }

  check(e: OrgEntitlements, key: FeatureKey): EntitlementResult {
    return checkEntitlement(e.ctx, key);
  }

  /** Customer-facing catalog: all 28 services, the skill that delivers each, and this org's access. */
  async catalog(orgId: string) {
    const e = await this.context(orgId);
    const planFeatures = e.subscription ? await this.db.planFeature.findMany({ where: { planId: e.subscription.planId } }) : [];
    const meta = new Map(planFeatures.map((f) => [f.featureKey, f.meta]));
    return {
      plan: e.subscription ? { code: e.subscription.plan.code as PlanCode, name: e.subscription.plan.name, status: e.subscription.status, currentPeriodEnd: e.subscription.currentPeriodEnd } : null,
      subscriptionVerified: e.ctx.subscriptionActive,
      features: FEATURE_KEYS.map((key) => {
        const def = FEATURES[key];
        const f = e.ctx.features.get(key);
        const r = this.check(e, key);
        return {
          key, label: def.label, section: def.section, skill: def.skill,
          connectors: FEATURE_CONNECTORS[key] ?? [],
          enabled: f?.enabled ?? false,
          limit: f ? f.limitValue : null,
          used: e.ctx.usage.get(key) ?? null,
          meta: meta.get(key) ?? null,
          access: r.allowed ? 'ALLOWED' : r.reason,
          remaining: r.allowed ? r.remaining : null,
        };
      }),
    };
  }

  /** Records quota consumption when a new listing is actually created on the marketplace. */
  async consume(orgId: string, key: FeatureKey, db: Db) {
    const sub = await this.currentSubscription(orgId, db);
    if (!sub?.currentPeriodStart) return;
    const periodStart = billingMonthStart(sub.currentPeriodStart);
    await db.usageCounter.upsert({
      where: { organizationId_featureKey_periodStart: { organizationId: orgId, featureKey: key, periodStart } },
      update: { used: { increment: 1 } },
      create: { organizationId: orgId, featureKey: key, periodStart, used: 1 },
    });
  }
}
