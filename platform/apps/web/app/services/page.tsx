import Link from 'next/link';
import type { Metadata } from 'next';
import { PageShell } from '@/components/Site';
import { SECTIONS, SECTION_LABEL } from '@/lib/api';
import { getPlans, type Plan } from '@/lib/plans';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Services — SOLLUNA Amazon & Flipkart management', description: '29 managed services across account setup, catalog, listings, ads, promotions, inventory, shipping labels, reporting, CA documentation and growth strategy.' };

const SECTION_COPY: Record<string, string> = {
  ACCOUNT_CATALOG: 'Seller registration, brand approval, mapping to existing ASINs/FSNs, new listings and SEO — built to each marketplace’s catalog rules.',
  REPORTING_SUPPORT: 'Monthly performance and P&L reports, CA documentation packs, seller-support cases and your dedicated manager.',
  GROWTH_MANAGEMENT: 'Ads, promotions, competitor and price monitoring, listing health, low-stock alerts and replenishment planning — every spend approved by you.',
  SHIPPING_BRANDING: 'Official shipping labels processed daily for eligible orders. Premium adds branded thank-you note inserts — your labels are never altered.',
  PREMIUM_BUSINESS: 'Product research, profitability and pricing, competitor strategy, expansion and launch planning for brands ready to scale.',
};

const DETAIL: Record<string, string> = {
  CATALOG_MAPPING: 'Match your products to existing ASINs/FSNs with confidence grading; high-confidence matches are human-reviewed before upload.',
  NEW_LISTING_AMAZON: 'Full detail pages: category, attributes, title, bullets, images QC, submission and live verification.',
  NEW_LISTING_FLIPKART: 'Vertical selection, attributes, brand checks, Seller Hub submission and live verification.',
  ADS_MANAGEMENT: 'Campaign setup and optimisation with ACOS/ROAS tracking. Ad budget is paid by you, separately, after approval.',
  SHIPPING_LABEL_GENERATION: 'Official marketplace labels, checked for duplicates and cancellations, shared as print-ready PDFs.',
  PERSONALIZED_THANK_YOU_NOTES: 'Branded inserts printed separately from the label, with marketplace-safe wording.',
  MONTHLY_PL_REPORT: 'Reconciled P&L: sales, fees, ads, COGS and expenses. Verified only when your costs are complete.',
  CA_DOCUMENTATION: 'Organised settlements, fee invoices, TCS and statements for your CA. Excludes filing and audit certification.',
  LOW_STOCK_ALERTS: 'Days-of-cover monitoring with Critical / High / Medium / Watch alerts and replenishment follow-up.',
};

function planBadges(plans: Plan[], key: string) {
  return plans.filter((p) => p.features.find((f) => f.key === key)?.enabled).map((p) => p.name);
}

export default async function Services() {
  const plans = await getPlans();
  const features = plans?.[0]?.features ?? [];
  return (
    <PageShell eyebrow="Services" title="29 services. One accountable team." intro="Every service follows a written procedure, is checked against your plan before work starts, and is tracked to completion with evidence in your dashboard.">
      {!plans && <p className="card mb-8 p-6 text-sm text-ink-3">Plan details are temporarily unavailable. Please refresh in a moment.</p>}
      <div className="space-y-14">
        {SECTIONS.map((s) => (
          <section key={s} aria-labelledby={`sec-${s}`}>
            <h2 id={`sec-${s}`} className="font-display text-3xl">{SECTION_LABEL[s]}</h2>
            <p className="mt-2 max-w-3xl text-ink-3">{SECTION_COPY[s]}</p>
            <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {features.filter((f) => f.section === s).map((f) => {
                const inPlans = planBadges(plans!, f.key);
                return (
                  <li key={f.key} className="card flex flex-col p-5">
                    <h3 className="font-semibold">{f.label.replace(' / Month', '')}</h3>
                    {DETAIL[f.key] && <p className="mt-2 text-sm text-ink-3">{DETAIL[f.key]}</p>}
                    <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                      {inPlans.map((n) => <span key={n} className={`chip ${n === 'Premium' ? 'bg-ink text-ivory' : n === 'Growth' ? 'bg-sun/15 text-sun-3' : 'bg-ink/5 text-ink-2'}`}>{n}</span>)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <div className="card mt-16 flex flex-wrap items-center justify-between gap-4 p-7">
        <div><p className="font-display text-2xl">Compare plans side by side</p><p className="text-sm text-ink-3">Monthly from ₹1,999 + GST. Upgrade any time.</p></div>
        <Link href="/#pricing" className="btn-gold">See pricing</Link>
      </div>
    </PageShell>
  );
}
