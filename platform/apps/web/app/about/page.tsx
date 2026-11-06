import Link from 'next/link';
import type { Metadata } from 'next';
import { H2, PageShell, Prose } from '@/components/Site';

export const metadata: Metadata = { title: 'About SOLLUNA — Marketplace management for Indian sellers', description: 'SOLLUNA runs Amazon and Flipkart operations for Indian brands and resellers with a dedicated manager, transparent tracking and approval-first execution.' };

const PRINCIPLES = [
  ['Approval before action', 'Ad budgets, price changes, promotions, purchases and material listing changes happen only after you approve them, action by action.'],
  ['Evidence, not claims', 'A task is complete when there is proof: a live listing URL, a marketplace case ID, a published report. No status is marked live on our word alone.'],
  ['One accountable manager', 'Every client has a named SOLLUNA manager reachable through Manager Chat Support, with response targets by priority.'],
  ['Honest numbers', 'P&L is verified only when your costs are in. Missing data is labelled estimated or unavailable — never presented as profit.'],
];

export default function About() {
  return (
    <PageShell eyebrow="About us" title="Specialists for the work behind every marketplace order." intro="SOLLUNA is a marketplace-management service for Indian sellers on Amazon and Flipkart, based in Kachchh, Gujarat and serving clients across India.">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Prose>
          <p>Selling on Amazon and Flipkart is many jobs at once: catalog and listings, brand approvals, ads, promotions, daily shipping labels, inventory, seller-support cases, settlements and the paperwork your CA needs. Most sellers end up doing all of it themselves — or not at all.</p>
          <p>SOLLUNA takes that operational load. Each client gets a private dashboard and a dedicated manager. Every request is routed to a defined service procedure, checked against your plan, tracked step by step and closed with proof.</p>
          <H2>How we work</H2>
          <p>We use only official, authorised access to your seller accounts. We never ask for your marketplace passwords or OTPs in chat. Where a marketplace offers no approved integration, we work manually through Seller Central and Seller Hub with your permission, and record what was done.</p>
          <p>Our plans are priced for growing businesses — ₹1,999, ₹4,999 and ₹9,999 a month plus GST — with a GST tax invoice for every payment so you can claim input tax credit.</p>
          <H2>What we don&apos;t promise</H2>
          <p>Marketplace approvals, search rankings and sales are decided by the marketplaces and your customers. We promise disciplined execution, transparency and honest reporting — not outcomes nobody can guarantee.</p>
        </Prose>
        <aside className="space-y-4">
          {PRINCIPLES.map(([t, d]) => (
            <div key={t} className="card p-6"><h3 className="font-semibold">{t}</h3><p className="mt-2 text-sm text-ink-3">{d}</p></div>
          ))}
          <div className="card bg-ink p-6 text-ivory">
            <p className="font-display text-xl">Talk to us</p>
            <p className="mt-2 text-sm text-ivory/70">Tell us about your catalog and we&apos;ll suggest the right plan.</p>
            <Link href="/contact" className="btn-gold mt-4">Contact SOLLUNA</Link>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
