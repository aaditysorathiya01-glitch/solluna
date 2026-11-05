/**
 * SOLLUNA service catalog — one feature key per row of the published plan matrix
 * (docs/plans/SOLLUNA_Marketplace_Management_Plans.txt) and one specialist skill per feature
 * (.claude/skills/<skill>/SKILL.md). The orchestrator skill routes work using these keys.
 *
 * Defaults below only SEED the database. At runtime the PlanFeature table (admin-editable) is
 * authoritative. limit: null = unlimited within the fair-use terms (T&C clause 12).
 */
export type PlanCode = 'RESELLER' | 'GROWTH' | 'PREMIUM';
export type Section = 'ACCOUNT_CATALOG' | 'REPORTING_SUPPORT' | 'GROWTH_MANAGEMENT' | 'SHIPPING_BRANDING' | 'PREMIUM_BUSINESS';

export interface FeatureDef {
  label: string;
  section: Section;
  skill: string; // .claude/skills/<skill>
  /** Usage meter: counted per marketplace per billing month. */
  metered?: boolean;
  plans: Record<PlanCode, { enabled: boolean; limit?: number | null; meta?: Record<string, unknown> }>;
}

const ALL = { RESELLER: { enabled: true }, GROWTH: { enabled: true }, PREMIUM: { enabled: true } };
const GROWTH_UP = { RESELLER: { enabled: false }, GROWTH: { enabled: true }, PREMIUM: { enabled: true } };
const PREMIUM_ONLY = { RESELLER: { enabled: false }, GROWTH: { enabled: false }, PREMIUM: { enabled: true } };
const LISTINGS = {
  RESELLER: { enabled: true, limit: 3 },
  GROWTH: { enabled: true, limit: 25 },
  PREMIUM: { enabled: true, limit: null },
};

export const FEATURES = {
  // ── Account & catalog services
  SELLER_ACCOUNT_REGISTRATION: { label: 'Seller Account Registration', section: 'ACCOUNT_CATALOG', skill: 'seller-account-registration', plans: ALL },
  BRAND_APPROVAL: { label: 'Brand Approval Assistance', section: 'ACCOUNT_CATALOG', skill: 'brand-approval-assistance', plans: ALL },
  CATALOG_MAPPING: { label: 'Unlimited Existing Catalog Mapping', section: 'ACCOUNT_CATALOG', skill: 'existing-catalog-mapping', plans: ALL },
  NEW_LISTING_AMAZON: { label: 'New Amazon Listings / Month', section: 'ACCOUNT_CATALOG', skill: 'amazon-new-listings', metered: true, plans: LISTINGS },
  NEW_LISTING_FLIPKART: { label: 'New Flipkart Listings / Month', section: 'ACCOUNT_CATALOG', skill: 'flipkart-new-listings', metered: true, plans: LISTINGS },
  SEO_KEYWORD_OPTIMIZATION: { label: 'SEO & Keyword Optimization', section: 'ACCOUNT_CATALOG', skill: 'seo-keyword-optimization', plans: ALL },

  // ── Reporting & support
  MONTHLY_PERFORMANCE_REPORT: { label: 'Monthly Business Performance Report', section: 'REPORTING_SUPPORT', skill: 'monthly-business-performance-report', plans: ALL },
  MONTHLY_PL_REPORT: { label: 'Monthly P&L Report', section: 'REPORTING_SUPPORT', skill: 'monthly-pl-report', plans: ALL },
  CA_DOCUMENTATION: { label: 'CA Documentation Support', section: 'REPORTING_SUPPORT', skill: 'ca-documentation-support', plans: ALL },
  MANAGER_CHAT: { label: 'Manager Chat Support', section: 'REPORTING_SUPPORT', skill: 'manager-chat-support', plans: ALL },
  MARKETPLACE_SUPPORT: { label: 'Marketplace Support & Communication', section: 'REPORTING_SUPPORT', skill: 'marketplace-support-communication', plans: ALL },
  CALL_SUPPORT: {
    label: 'Call Support', section: 'REPORTING_SUPPORT', skill: 'call-support',
    plans: {
      RESELLER: { enabled: false },
      GROWTH: { enabled: true, meta: { mode: 'ON_REQUEST' } },
      PREMIUM: { enabled: true, meta: { mode: 'PRIORITY' } },
    },
  },

  // ── Growth & management
  ADS_MANAGEMENT: { label: 'Ads Management', section: 'GROWTH_MANAGEMENT', skill: 'ads-management', plans: GROWTH_UP },
  PROMOTIONAL_MANAGEMENT: { label: 'Promotional Management', section: 'GROWTH_MANAGEMENT', skill: 'promotional-management', plans: GROWTH_UP },
  LOW_STOCK_ALERTS: { label: 'Low Stock Alerts', section: 'GROWTH_MANAGEMENT', skill: 'low-stock-alerts', plans: GROWTH_UP },
  COMPETITOR_PRICE_MONITORING: { label: 'Competitor & Price Monitoring', section: 'GROWTH_MANAGEMENT', skill: 'competitor-price-monitoring', plans: GROWTH_UP },
  LISTING_HEALTH_MONITORING: { label: 'Listing Health Monitoring', section: 'GROWTH_MANAGEMENT', skill: 'listing-health-monitoring', plans: GROWTH_UP },
  INVENTORY_REPLENISHMENT: { label: 'Inventory & Replenishment Planning', section: 'GROWTH_MANAGEMENT', skill: 'inventory-replenishment-planning', plans: GROWTH_UP },

  // ── Shipping & branding
  SHIPPING_LABEL_GENERATION: { label: 'Shipping Label Generation', section: 'SHIPPING_BRANDING', skill: 'shipping-label-generation', plans: GROWTH_UP },
  DAILY_LABEL_PROCESSING: { label: 'Daily Label Processing & Delivery', section: 'SHIPPING_BRANDING', skill: 'daily-label-processing-delivery', plans: GROWTH_UP },
  PERSONALIZED_THANK_YOU_NOTES: { label: 'Personalized Thank You Notes', section: 'SHIPPING_BRANDING', skill: 'personalized-thank-you-notes', plans: PREMIUM_ONLY },
  CUSTOM_THANK_YOU_DESIGN: { label: 'Customized Thank You Note Design', section: 'SHIPPING_BRANDING', skill: 'customized-thank-you-note-design', plans: PREMIUM_ONLY },

  // ── Premium business services
  PRODUCT_RESEARCH: { label: 'Product Research & Suggestions', section: 'PREMIUM_BUSINESS', skill: 'product-research-suggestions', plans: PREMIUM_ONLY },
  BUSINESS_GROWTH_SUGGESTIONS: { label: 'Business Growth & Improvement Suggestions', section: 'PREMIUM_BUSINESS', skill: 'business-growth-improvement-suggestions', plans: PREMIUM_ONLY },
  COMPETITOR_STRATEGY: { label: 'Competitor Strategy & Analysis', section: 'PREMIUM_BUSINESS', skill: 'competitor-strategy-analysis', plans: PREMIUM_ONLY },
  BUSINESS_EXPANSION: { label: 'Business Expansion Guidance', section: 'PREMIUM_BUSINESS', skill: 'business-expansion-guidance', plans: PREMIUM_ONLY },
  PROFITABILITY_PRICING: { label: 'Profitability & Pricing Strategy', section: 'PREMIUM_BUSINESS', skill: 'profitability-pricing-strategy', plans: PREMIUM_ONLY },
  NEW_PRODUCT_LAUNCH: { label: 'New Product Launch Strategy', section: 'PREMIUM_BUSINESS', skill: 'new-product-launch-strategy', plans: PREMIUM_ONLY },
} satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
export const ORCHESTRATOR_SKILL = 'solluna-skill-orchestrator';

export const PLANS: Record<PlanCode, { name: string; pricePaise: number; sortOrder: number }> = {
  RESELLER: { name: 'Reseller', pricePaise: 199900, sortOrder: 0 },
  GROWTH: { name: 'Growth', pricePaise: 499900, sortOrder: 1 },
  PREMIUM: { name: 'Premium', pricePaise: 999900, sortOrder: 2 },
};
