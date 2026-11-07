import type { Metadata } from 'next';
import Link from 'next/link';
import { CONTACT, H2, PageShell, Prose } from '@/components/Site';

export const metadata: Metadata = { title: 'Terms & Conditions — SOLLUNA' };

const PLAN_TERMS = [
  'All plans cover Amazon and Flipkart only.',
  'Seller account registration and brand approval depend on marketplace requirements and client-provided documents. Approval is not guaranteed.',
  'Unlimited existing catalog mapping applies to eligible existing branded products.',
  'New listing limits are per platform, per billing month: 3, 25 or unlimited, depending on the plan.',
  'SEO optimization is based on keyword research and marketplace best practices. Search ranking and sales are not guaranteed.',
  'Accurate P&L reporting requires product costs and other relevant expense details from the client.',
  'CA documentation support includes available marketplace reports, statements and transaction records. Tax filing and audit certification are not included.',
  'Ads management is included in Growth and Premium; advertising budget is paid separately by the client.',
  'Promotions and deals are subject to marketplace eligibility, approval and applicable charges.',
  'Shipping labels are processed for eligible orders and shared according to the agreed daily schedule. Actual delivery depends on timely order data and marketplace availability.',
  'Personalized Thank You Notes are separate printable inserts for parcels. Official marketplace shipping labels will not be altered.',
  'Unlimited services are subject to operational feasibility, platform rules and agreed processing schedules. Complex catalog work, extensive creative production and exceptional bulk requirements may be separately chargeable.',
];

export default function Terms() {
  return (
    <PageShell eyebrow="Legal" title="Terms & Conditions" intro="Effective 7 November 2026. These terms form the agreement between you and SOLLUNA when you register or subscribe.">
      <Prose>
        <H2>1. Who we are</H2>
        <p>SOLLUNA is operated by {CONTACT.legalName} (GSTIN {CONTACT.gstin}), Survey No 135, Plot No 9, Shreeji Nagar, Meghpar Kumbhardi Sim, Anjar, Kachchh, Gujarat 370110 (&ldquo;SOLLUNA&rdquo;, &ldquo;we&rdquo;). &ldquo;You&rdquo; means the business that registers an account.</p>
        <H2>2. Plan scope</H2>
        <ol className="list-decimal space-y-2 pl-5">{PLAN_TERMS.map((t) => <li key={t}>{t}</li>)}</ol>
        <H2>3. Fees, GST and invoices</H2>
        <p>Plans are billed monthly in advance at the price shown at checkout. Prices exclude GST; GST at the applicable rate (currently 18%) is added. A GST tax invoice is issued for every verified payment. A plan is activated only after Razorpay confirms the payment to our servers. Marketplace fees, advertising spend, promotion charges and any third-party costs are payable by you directly and are not part of the subscription.</p>
        <H2>4. Your approvals</H2>
        <p>We do not spend your money or make consequential changes without your explicit approval in the dashboard. This includes ad budgets, purchases, marketplace fees, price or offer changes, material listing changes, consequential order actions, sharing your data with third parties, and any work outside your plan.</p>
        <H2>5. Your responsibilities</H2>
        <p>You confirm that the information, documents, images, brand rights and product claims you provide are accurate and that you are entitled to sell the products. You grant us authorised access to your seller accounts as described in section 6. Never share your passwords or OTPs with us; we will not ask for them. You remain the account holder and are responsible for compliance with marketplace policies, tax and product laws.</p>
        <H2>6. Seller account access and automation</H2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>You add SOLLUNA as a user in Amazon Seller Central and/or Flipkart Seller Hub (&ldquo;Add a new user&rdquo;). SOLLUNA signs in with its own login, email and phone; one-time passwords go to SOLLUNA, never to you, and we never ask for your password or OTP.</li>
          <li>You authorise SOLLUNA to use that access, including automated software tools operated by SOLLUNA (AI agents and browser automation), to deliver the services in your plan.</li>
          <li>SOLLUNA will never change your bank details, payment or settlement settings, or the users on your account. Price, advertising budget, offers, material listing changes and other actions listed in section 4 are made only after your approval in the dashboard. Every action is recorded and visible to you.</li>
          <li>Amazon and Flipkart prefer official APIs for automated work and may treat automated use of their seller portals as a policy concern, which can lead to verification requests or restrictions on your account. You understand and accept this risk. SOLLUNA applies safeguards (limited daily actions, no access to bank, payment or user settings) and moves your account to official API integrations (Amazon SP-API / Ads API, Flipkart Seller API) as soon as they are available to us.</li>
          <li>You may remove SOLLUNA&rsquo;s user access at any time; services that need access will pause until it is restored.</li>
        </ol>
        <H2>7. Service delivery</H2>
        <p>We deliver services through documented procedures on business days, Monday to Saturday, excluding public holidays. Response targets for Manager Chat Support depend on priority (P1 30 minutes, P2 2 business hours, P3 1 business day, P4 2 business days). Timelines that depend on marketplaces, couriers or your inputs may vary.</p>
        <H2>8. No guarantees of marketplace outcomes</H2>
        <p>Marketplace approvals, catalog decisions, rankings, Buy Box, advertising results and sales are controlled by the marketplaces and customers. We do not guarantee them. Reports are prepared from the data available to us and are labelled verified, estimated or unavailable accordingly.</p>
        <H2>9. Fair use</H2>
        <p>&ldquo;Unlimited&rdquo; means no numeric monthly cap, subject to operational feasibility, marketplace rules and agreed schedules. It does not mean unlimited parallel human work. Exceptional bulk or creative work may be quoted separately and starts only after your approval.</p>
        <H2>10. Confidentiality and data</H2>
        <p>We keep your business information confidential and process personal data as described in our <Link className="underline" href="/privacy">Privacy Policy</Link>.</p>
        <H2>11. Cancellation and refunds</H2>
        <p>Governed by our <Link className="underline" href="/refund-policy">Refund &amp; Cancellation Policy</Link>.</p>
        <H2>12. Suspension</H2>
        <p>We may pause services for non-payment, misuse, illegal or prohibited products, or conduct that risks your or our marketplace accounts. We will tell you the reason.</p>
        <H2>13. Liability</H2>
        <p>To the extent permitted by law, our total liability for any claim is limited to the subscription fees you paid in the three months before the event, and we are not liable for indirect losses, lost profits, marketplace penalties caused by your instructions or information, marketplace actions arising from the access you authorised in section 6, or actions of marketplaces and third parties.</p>
        <H2>14. Changes</H2>
        <p>We may update these terms or plan features with notice in your dashboard. Price changes apply from your next billing month.</p>
        <H2>15. Law and disputes</H2>
        <p>These terms are governed by the laws of India. Courts at Kachchh, Gujarat have exclusive jurisdiction. Contact <a className="underline" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> first — we aim to resolve complaints within 15 business days.</p>
      </Prose>
    </PageShell>
  );
}
