import type { Metadata } from 'next';
import { PageShell } from '@/components/Site';
import { GuideShots } from './GuideShots';

export const metadata: Metadata = { title: 'Add SOLLUNA as a user — SOLLUNA', description: 'Step-by-step: give SOLLUNA access to your Flipkart Seller Hub or Amazon Seller Central without sharing your password.' };

const OPS = { name: process.env.OPS_USER_NAME ?? 'SOLLUNA Operations', email: process.env.OPS_USER_EMAIL ?? 'ops@solluna.co.in', role: process.env.OPS_USER_ROLE ?? 'Admin' };

const GUIDES = {
  flipkart: {
    title: 'Flipkart Seller Hub',
    steps: [
      'Open Seller Hub and click your store name (top right) → Profile.',
      'On the Profile page, open Manage Users (click View).',
      'Click Add New User.',
      `Fill in Role: ${OPS.role}, Name: ${OPS.name}, Email Id: ${OPS.email}, Phone number: your own mobile number, then click Save. We receive an invite email and confirm it from our side.`,
    ],
  },
  amazon: {
    title: 'Amazon Seller Central',
    steps: [
      'Open Seller Central and click the Settings icon (gear, top right).',
      'Click Manage permissions.',
      'On Manage Employees, click Actions → Invite Employee.',
      `Fill in Name: ${OPS.name} and E-mail: ${OPS.email}, keep sellerCentral ticked, then click Send Invite. After we accept, click Confirm next to SOLLUNA and give View & Edit for Inventory (Manage Inventory/Add a Product), Products (View Products) and Orders (Manage permissions → SOLLUNA → Manage → set these to View & Edit → Continue). Bank and payment sections are not needed.`,
    ],
  },
} as const;

export default async function AddSollunaUser({ searchParams }: { searchParams: Promise<{ mp?: string }> }) {
  const { mp } = await searchParams;
  const order = mp === 'amazon' ? (['amazon', 'flipkart'] as const) : (['flipkart', 'amazon'] as const);
  return (
    <PageShell eyebrow="Help" title="Add SOLLUNA as a user" intro="SOLLUNA never needs your password or OTP. You add SOLLUNA as a user on your seller account, and you can remove it at any time.">
      <div className="max-w-3xl space-y-8">
        {order.map((key) => (
          <section key={key} id={key} className="rounded-2xl border border-ink/10 bg-white p-6" aria-label={GUIDES[key].title}>
            <h2 className="font-display text-2xl">{GUIDES[key].title}</h2>
            <ol className="mt-4 space-y-4">
              {GUIDES[key].steps.map((s, i) => (
                <li key={s} className="space-y-2">
                  <p className="text-sm leading-6"><span className="mr-2 font-semibold">{i + 1}.</span>{s}</p>
                  <GuideShots src={`/guides/${key}-${i + 1}.png`} alt={`${GUIDES[key].title} step ${i + 1}`} />
                </li>
              ))}
            </ol>
          </section>
        ))}
        <p className="text-sm text-ink-3">Stuck on a step? Send a screenshot to your manager in Manager Chat.</p>
      </div>
    </PageShell>
  );
}
