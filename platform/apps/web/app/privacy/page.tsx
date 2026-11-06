import type { Metadata } from 'next';
import { CONTACT, H2, PageShell, Prose } from '@/components/Site';

export const metadata: Metadata = { title: 'Privacy Policy — SOLLUNA' };

export default function Privacy() {
  return (
    <PageShell eyebrow="Legal" title="Privacy Policy" intro="Effective 6 November 2026. How SOLLUNA collects, uses and protects personal data, in line with the Digital Personal Data Protection Act, 2023.">
      <Prose>
        <H2>1. Data we collect</H2>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Account:</strong> name, email, mobile number, password (stored only as a one-way hash).</li>
          <li><strong>Business:</strong> legal and brand name, GSTIN, PAN, address, category, marketplace store names and seller IDs.</li>
          <li><strong>Documents and content:</strong> files you upload, chat messages, tickets, product data and images.</li>
          <li><strong>Marketplace and order data:</strong> reports, settlements, inventory and order data needed for the services you request.</li>
          <li><strong>Payments:</strong> processed by Razorpay. We receive payment status and IDs — never your card, UPI PIN or bank credentials.</li>
          <li><strong>Technical:</strong> IP address and security logs for sign-in protection and audit.</li>
        </ul>
        <H2>2. Why we use it</H2>
        <p>To provide and bill the services you subscribe to, issue GST invoices, communicate with you, protect accounts (rate limiting, audit logs, two-factor authentication for staff), meet legal obligations and improve our processes. We do not sell personal data or use your buyers&apos; data for unrelated marketing or profiling.</p>
        <H2>3. Buyer data on orders and labels</H2>
        <p>Where we process orders and shipping labels, we use buyer information only to fulfil those orders as your processor. Thank-you notes are non-personalised by default; personalisation uses the minimum data (such as first name) only with your approved basis, and is not retained longer than needed.</p>
        <H2>4. Sharing</H2>
        <p>We share data only with: Amazon and Flipkart (to perform services on your accounts), Razorpay (payments), our hosting, email and document-storage providers, and authorities where law requires. Any other third-party sharing needs your explicit approval.</p>
        <H2>5. Access inside SOLLUNA</H2>
        <p>Staff see only clients they are assigned to or working for, by role. Staff downloads of client files are logged. Access is revoked immediately when an employee leaves.</p>
        <H2>6. Security</H2>
        <p>Data is encrypted in transit (HTTPS). Secrets such as authentication seeds are encrypted at rest. Uploads are checked by content type. Each client&apos;s data is isolated from every other client&apos;s.</p>
        <H2>7. Retention</H2>
        <p>We keep account and service records while you are a client and afterwards as long as needed for tax, accounting and legal purposes (invoices and financial records: at least 8 years under GST law). You may ask us to delete other data when you leave.</p>
        <H2>8. Your rights</H2>
        <p>You may request access to, correction of, or erasure of your personal data, withdraw consent, and nominate a person to exercise these rights. Write to our grievance contact below; we respond within 30 days.</p>
        <H2>9. Grievance officer</H2>
        <p>{CONTACT.legalName} · <a className="underline" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> · Anjar, Kachchh, Gujarat 370110.</p>
      </Prose>
    </PageShell>
  );
}
