import type { FeatureKey } from '../../../../packages/permissions/src/features';

/**
 * Workflow templates = solluna-skill-orchestrator "Step 4 — Build dependencies".
 * Each step is executed under the specialist skill of its `feature`.
 */
export type ApprovalAction = 'AD_BUDGET' | 'SPEND' | 'MARKETPLACE_FEE' | 'PRICE_CHANGE' | 'CONTENT_CHANGE' | 'ORDER_ACTION' | 'DATA_SHARE' | 'OUT_OF_PLAN';

export interface Step {
  key: string;
  feature: FeatureKey | 'REQUESTED';     // 'REQUESTED' = the feature the client asked for
  title: string;
  dependsOn?: string[];
  /** Client approval of this action type is required before the step may start. */
  approval?: ApprovalAction;
  /** Skip this step when a dependency finished with this outcome (e.g. existing catalog match found). */
  skipWhen?: { step: string; outcome: string; reason: string };
  /** Only include the step if the client's plan includes its feature (otherwise omit, don't block). */
  ifEntitled?: boolean;
  /** Include only if the request details set this flag. */
  ifDetail?: string;
  /** Completing this step with outcome CATALOG_ID_CREATED consumes one unit of the requested feature's quota. */
  consumesQuota?: boolean;
  /** Evidence must carry `outcome` from this list. */
  outcomes?: string[];
}

export interface Workflow { id: string; label: string; steps: Step[] }

const NEW_LISTING: Workflow = {
  id: 'new-listing',
  label: 'New listing (catalog check → new listing → SEO)',
  steps: [
    { key: 'catalog-check', feature: 'CATALOG_MAPPING', title: 'Check for an existing ASIN/FSN before creating a new listing', outcomes: ['EXISTING_FOUND', 'NO_MATCH_FOUND'] },
    { key: 'create-listing', feature: 'REQUESTED', title: 'Create the new listing', dependsOn: ['catalog-check'], consumesQuota: true, outcomes: ['CATALOG_ID_CREATED'],
      skipWhen: { step: 'catalog-check', outcome: 'EXISTING_FOUND', reason: 'Mapped to an existing catalog entry — no new listing needed, quota not used' } },
    { key: 'seo', feature: 'SEO_KEYWORD_OPTIMIZATION', title: 'Keyword research and listing content optimization', dependsOn: ['create-listing'],
      skipWhen: { step: 'catalog-check', outcome: 'EXISTING_FOUND', reason: 'Existing catalog entry — content owned by the catalog' } },
  ],
};

const REPLENISHMENT: Workflow = {
  id: 'replenishment',
  label: 'Low stock and replenishment',
  steps: [
    { key: 'stock-check', feature: 'LOW_STOCK_ALERTS', title: 'Retrieve inventory and sales, run low-stock monitoring' },
    { key: 'plan', feature: 'INVENTORY_REPLENISHMENT', title: 'Prepare replenishment recommendation', dependsOn: ['stock-check'] },
    { key: 'purchase-approval', feature: 'INVENTORY_REPLENISHMENT', title: 'Client approves purchase / stock commitment', dependsOn: ['plan'], approval: 'SPEND' },
  ],
};

const ADVERTISING: Workflow = {
  id: 'advertising',
  label: 'Advertising (audit → approval → launch → report)',
  steps: [
    { key: 'strategy', feature: 'ADS_MANAGEMENT', title: 'Review eligibility, prepare campaign structure, budget and targeting' },
    { key: 'launch', feature: 'ADS_MANAGEMENT', title: 'Launch campaigns as approved', dependsOn: ['strategy'], approval: 'AD_BUDGET' },
    { key: 'report', feature: 'ADS_MANAGEMENT', title: 'Monitor and report spend, sales and ACOS/ROAS', dependsOn: ['launch'] },
  ],
};

const PROMOTION: Workflow = {
  id: 'promotion',
  label: 'Promotion (proposal → approval → submit)',
  steps: [
    { key: 'proposal', feature: 'PROMOTIONAL_MANAGEMENT', title: 'Check eligibility and margin, prepare promotion proposal' },
    { key: 'submit', feature: 'PROMOTIONAL_MANAGEMENT', title: 'Submit promotion to the marketplace', dependsOn: ['proposal'], approval: 'PRICE_CHANGE' },
  ],
};

const SHIPPING_LABELS: Workflow = {
  id: 'shipping-labels',
  label: 'Shipping labels (generate → thank-you inserts → deliver)',
  steps: [
    { key: 'generate', feature: 'SHIPPING_LABEL_GENERATION', title: 'Generate and validate official labels for eligible orders' },
    { key: 'thank-you-notes', feature: 'PERSONALIZED_THANK_YOU_NOTES', title: 'Prepare personalized thank-you inserts (separate from labels)', dependsOn: ['generate'], ifEntitled: true },
    { key: 'deliver', feature: 'DAILY_LABEL_PROCESSING', title: 'Batch, reconcile and deliver print-ready files', dependsOn: ['generate', 'thank-you-notes'] },
  ],
};

const MONTHLY_REPORTING: Workflow = {
  id: 'monthly-reporting',
  label: 'Monthly reporting (performance → P&L → CA pack)',
  steps: [
    { key: 'performance', feature: 'MONTHLY_PERFORMANCE_REPORT', title: 'Monthly business performance report' },
    { key: 'pl', feature: 'MONTHLY_PL_REPORT', title: 'Monthly P&L using verified costs (missing costs disclosed)', dependsOn: ['performance'] },
    { key: 'ca-pack', feature: 'CA_DOCUMENTATION', title: 'Organize CA documentation pack', dependsOn: ['pl'], ifDetail: 'includeCaPack' },
  ],
};

const BY_FEATURE: Partial<Record<FeatureKey, Workflow>> = {
  NEW_LISTING_AMAZON: NEW_LISTING,
  NEW_LISTING_FLIPKART: NEW_LISTING,
  LOW_STOCK_ALERTS: REPLENISHMENT,
  INVENTORY_REPLENISHMENT: REPLENISHMENT,
  ADS_MANAGEMENT: ADVERTISING,
  PROMOTIONAL_MANAGEMENT: PROMOTION,
  SHIPPING_LABEL_GENERATION: SHIPPING_LABELS,
  DAILY_LABEL_PROCESSING: SHIPPING_LABELS,
  MONTHLY_PERFORMANCE_REPORT: MONTHLY_REPORTING,
  MONTHLY_PL_REPORT: MONTHLY_REPORTING,
};

export function workflowFor(feature: FeatureKey): Workflow {
  return BY_FEATURE[feature] ?? { id: 'single', label: 'Single specialist task', steps: [{ key: 'execute', feature: 'REQUESTED', title: 'Execute request' }] };
}

/** Marketplace is mandatory for these (Amazon and Flipkart records are kept separate). */
export const MARKETPLACE_REQUIRED: FeatureKey[] = ['NEW_LISTING_AMAZON', 'NEW_LISTING_FLIPKART', 'ADS_MANAGEMENT', 'PROMOTIONAL_MANAGEMENT', 'SHIPPING_LABEL_GENERATION', 'DAILY_LABEL_PROCESSING', 'MARKETPLACE_SUPPORT'];
export const FIXED_MARKETPLACE: Partial<Record<FeatureKey, 'AMAZON' | 'FLIPKART'>> = { NEW_LISTING_AMAZON: 'AMAZON', NEW_LISTING_FLIPKART: 'FLIPKART' };
