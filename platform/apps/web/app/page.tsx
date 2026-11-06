import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/Site';
import { SECTIONS, SECTION_LABEL, inr } from '@/lib/api';
import { getPlans, type Plan, type PlanFeature } from '@/lib/plans';
import { FAQS } from '@/lib/faq';

export const dynamic = 'force-dynamic';

function cell(f: PlanFeature | undefined) {
  if (!f || !f.enabled) return <span className="text-ink/25">—</span>;
  if (f.meta?.mode === 'ON_REQUEST') return 'On request';
  if (f.meta?.mode === 'PRIORITY') return <span className="font-semibold text-sun-3">Priority</span>;
  if (f.key.startsWith('NEW_LISTING')) return f.limit === null ? 'Unlimited' : f.limit;
  if (f.key === 'SHIPPING_LABEL_GENERATION') return 'Unlimited';
  return <span className="text-sun-3">✓</span>;
}

const TAGLINE: Record<string, string> = {
  RESELLER: 'Account, catalog and reporting essentials',
  GROWTH: 'Ads, promotions, inventory and daily labels',
  PREMIUM: 'Full management with strategy and branding',
};

const WHY = [
  ['Approval-first execution', 'Nothing that costs you money or changes your listings happens without your explicit approval in the dashboard.'],
  ['Proof for every status', 'Live listing URLs, marketplace case IDs and published reports — progress you can verify, not take on trust.'],
  ['GST-ready billing', 'Transparent GST-exclusive pricing with a proper tax invoice for every payment, so you can claim input tax credit.'],
  ['Your own manager', 'A named SOLLUNA manager, Manager Chat Support and response targets by priority.'],
  ['Secure by design', 'No marketplace passwords, isolated client data, audited staff access and two-factor-protected admin.'],
  ['Honest reporting', 'Monthly P&L marked verified, estimated or unavailable — never profit you cannot rely on.'],
];

const STEPS = [
  ['Choose a plan', 'Pick Reseller, Growth or Premium and pay securely with Razorpay.'],
  ['Onboard your business', 'Share GST, brand and seller details. We verify documents before any submission.'],
  ['Meet your manager', 'A dedicated SOLLUNA manager is assigned and reachable via Manager Chat Support.'],
  ['Request, approve, track', 'Raise requests, approve spends and price changes, and track every step to completion.'],
];

export default async function Home() {
  const plans = await getPlans();
  const rows = plans?.[0]?.features ?? [];

  return (
    <main>
      <header className="bg-ink">
        <SiteHeader dark />
        <section className="mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6 sm:pt-20">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.25em] text-sun-2">Amazon · Flipkart · India</p>
          <h1 className="max-w-3xl font-display text-4xl leading-tight text-ivory sm:text-6xl">
            Your marketplace business, run by specialists.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ivory/75">
            Listings, catalog mapping, ads, promotions, daily labels, P&amp;L and CA documentation, all handled by a dedicated
            SOLLUNA manager and tracked transparently in your own dashboard.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/register" className="btn-gold px-7 py-3">Start with a plan</Link>
            <a href="#pricing" className="btn border border-ivory/25 px-7 py-3 text-ivory hover:border-ivory/60">Compare plans</a>
          </div>
          <dl className="mt-14 grid max-w-3xl grid-cols-2 gap-6 text-ivory sm:grid-cols-4">
            {[['29', 'managed services'], ['2', 'marketplaces'], ['1', 'dedicated manager'], ['0', 'actions without approval']].map(([n, l]) => (
              <div key={l}><dt className="font-display text-3xl text-sun-2">{n}</dt><dd className="text-sm text-ivory/60">{l}</dd></div>
            ))}
          </dl>
        </section>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="font-display text-3xl">How SOLLUNA works</h2>
        <ol className="mt-10 grid gap-5 md:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="card p-6">
              <span className="font-display text-2xl text-sun">0{i + 1}</span>
              <h3 className="mt-3 font-semibold">{t}</h3>
              <p className="mt-2 text-sm text-ink-3">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-3xl">Why sellers choose SOLLUNA</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {WHY.map(([t, d]) => (
              <div key={t} className="border-l-2 border-sun pl-5"><h3 className="font-semibold">{t}</h3><p className="mt-2 text-sm text-ink-3">{d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="bg-ivory-2 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-3xl">Plans</h2>
          <p className="mt-2 text-ink-3">Monthly, plus 18% GST. Every payment comes with a GST tax invoice for your input tax credit. Amazon and Flipkart included in every plan.</p>
          {!plans ? (
            <p className="card mt-8 p-6 text-sm text-ink-3">Pricing is temporarily unavailable. Please refresh in a moment.</p>
          ) : (
            <>
              <div className="mt-10 grid gap-5 md:grid-cols-3">
                {plans.map((p) => (
                  <div key={p.code} className={`card flex flex-col p-7 ${p.code === 'GROWTH' ? 'ring-2 ring-sun' : ''}`}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-ink-3">{p.name}</h3>
                      {p.code === 'GROWTH' && <span className="chip bg-sun/15 text-sun-3">Most chosen</span>}
                    </div>
                    <p className="mt-4 font-display text-4xl">{inr(p.pricePaise)}<span className="font-sans text-base text-ink-3"> /month + GST</span></p>
                    <p className="mt-2 text-sm text-ink-3">{TAGLINE[p.code]}</p>
                    <p className="mt-5 text-sm"><strong>{p.features.filter((f) => f.enabled).length}</strong> of {p.features.length} services included</p>
                    <Link href={`/register?plan=${p.code}`} className={`${p.code === 'GROWTH' ? 'btn-gold' : 'btn-primary'} mt-7`}>Choose {p.name}</Link>
                  </div>
                ))}
              </div>

              <div className="card mt-10 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 text-left">
                      <th className="p-4 font-semibold">Services</th>
                      {plans.map((p) => <th key={p.code} className="p-4 text-center font-semibold">{p.name}<div className="font-normal text-ink-3">{inr(p.pricePaise)}</div></th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {SECTIONS.map((s) => (
                      <SectionRows key={s} section={s} rows={rows.filter((r) => r.section === s)} plans={plans} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <ul className="mt-8 space-y-1.5 text-xs text-ink-3">
            <li>New listing limits are per marketplace, per billing month. Existing catalog mapping does not count towards them.</li>
            <li>Marketplace approvals, rankings and sales are not guaranteed. Advertising budgets are paid by you, separately.</li>
            <li>Accurate P&amp;L needs your product costs. CA documentation support excludes tax filing and audit certification.</li>
            <li>Unlimited services follow operational feasibility, marketplace rules and agreed processing schedules.</li>
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div>
            <h2 className="font-display text-3xl">Common questions</h2>
            <p className="mt-3 text-ink-3">More in the <Link className="underline" href="/faq">full FAQ</Link>.</p>
          </div>
          <div className="divide-y divide-ink/10 rounded-2xl border border-ink/10 bg-white">
            {FAQS.slice(0, 5).map(([q, a]) => (
              <details key={q} className="group p-5 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">{q}<span className="text-sun transition group-open:rotate-45" aria-hidden>+</span></summary>
                <p className="mt-3 text-sm leading-6 text-ink-3">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-ink-2">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-14 sm:px-6">
          <div><p className="font-display text-3xl text-ivory">Ready to hand over the operations?</p><p className="mt-2 text-ivory/60">Start today, or talk to us first about your catalog.</p></div>
          <div className="flex flex-wrap gap-3"><Link href="/register" className="btn-gold px-7 py-3">Get started</Link><Link href="/contact" className="btn border border-ivory/25 px-7 py-3 text-ivory hover:border-ivory/60">Contact us</Link></div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

function SectionRows({ section, rows, plans }: { section: string; rows: PlanFeature[]; plans: Plan[] }) {
  return (
    <>
      <tr className="bg-ivory/60"><td colSpan={plans.length + 1} className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-3">{SECTION_LABEL[section]}</td></tr>
      {rows.map((r) => (
        <tr key={r.key} className="border-t border-ink/5">
          <td className="p-4">{r.label.replace(' / Month', '')}{r.key.startsWith('NEW_LISTING') && <span className="text-ink-3"> / month</span>}</td>
          {plans.map((p) => <td key={p.code} className="p-4 text-center">{cell(p.features.find((f) => f.key === r.key))}</td>)}
        </tr>
      ))}
    </>
  );
}
