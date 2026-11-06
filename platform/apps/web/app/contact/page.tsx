import type { Metadata } from 'next';
import { CONTACT, PageShell } from '@/components/Site';
import { ContactForm } from '@/components/ContactForm';

export const metadata: Metadata = { title: 'Contact SOLLUNA', description: 'Talk to SOLLUNA about Amazon and Flipkart marketplace management.' };

export default function Contact() {
  return (
    <PageShell eyebrow="Contact" title="Tell us about your marketplace business." intro="We reply within one business day. Existing clients get faster help through Manager Chat Support in the dashboard.">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ContactForm />
        <aside className="space-y-4 text-sm">
          <div className="card p-6">
            <p className="label">Email</p>
            <a className="text-base font-semibold underline" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
          </div>
          <div className="card p-6">
            <p className="label">Registered business</p>
            <p>{CONTACT.legalName}</p>
            <p className="mt-1 text-ink-3">Survey No 135, Plot No 9, Shreeji Nagar, Meghpar Kumbhardi Sim, Anjar, Kachchh, Gujarat 370110</p>
            <p className="mt-1 text-ink-3">GSTIN {CONTACT.gstin}</p>
          </div>
          <div className="card p-6">
            <p className="label">Hours</p>
            <p>Monday–Saturday, 10:00–19:00 IST</p>
            <p className="mt-1 text-ink-3">Urgent client issues (P1) are acknowledged within 30 minutes during business hours.</p>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
