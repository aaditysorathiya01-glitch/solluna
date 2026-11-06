export interface PlanFeature { key: string; label: string; section: string; enabled: boolean; limit: number | null; meta: { mode?: string } | null }
export interface Plan { code: string; name: string; pricePaise: number; features: PlanFeature[] }

/** Plans come from the API (DB), so admin edits to prices/limits show on the public site without a deploy. */
export async function getPlans(): Promise<Plan[] | null> {
  try {
    const r = await fetch(`${process.env.API_URL ?? 'http://localhost:4000'}/api/plans`, { cache: 'no-store' });
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}
