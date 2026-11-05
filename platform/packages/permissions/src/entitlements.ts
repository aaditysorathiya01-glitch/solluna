import type { FeatureKey } from './features';

/** Resolved from DB: active subscription → plan → plan_features, plus usage counters. */
export interface EntitlementContext {
  /** ACTIVE/GRACE_PERIOD = true; null = status could not be verified (orchestrator: Pending Verification). */
  subscriptionActive: boolean | null;
  features: Map<FeatureKey, { enabled: boolean; limitValue: number | null }>;
  usage: Map<FeatureKey, number>; // used in current billing period
}

export type EntitlementResult =
  | { allowed: true; remaining: number | null }
  | { allowed: false; reason: 'PENDING_VERIFICATION' | 'NO_ACTIVE_SUBSCRIPTION' | 'FEATURE_NOT_IN_PLAN' | 'LIMIT_REACHED' };

/**
 * Backend gate for every plan-controlled action. The API must call this —
 * hiding a button in the UI is never enforcement.
 */
export function checkEntitlement(ctx: EntitlementContext, feature: FeatureKey, units = 1): EntitlementResult {
  if (ctx.subscriptionActive === null) return { allowed: false, reason: 'PENDING_VERIFICATION' };
  if (!ctx.subscriptionActive) return { allowed: false, reason: 'NO_ACTIVE_SUBSCRIPTION' };
  const f = ctx.features.get(feature);
  if (!f || !f.enabled) return { allowed: false, reason: 'FEATURE_NOT_IN_PLAN' };
  if (f.limitValue === null) return { allowed: true, remaining: null };
  const used = ctx.usage.get(feature) ?? 0;
  if (used + units > f.limitValue) return { allowed: false, reason: 'LIMIT_REACHED' };
  return { allowed: true, remaining: f.limitValue - used - units };
}
