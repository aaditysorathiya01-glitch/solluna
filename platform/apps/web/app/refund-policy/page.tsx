import type { Metadata } from 'next';
import { CONTACT, H2, PageShell, Prose } from '@/components/Site';

export const metadata: Metadata = { title: 'Refund & Cancellation Policy — SOLLUNA' };

export default function Refund() {
  return (
    <PageShell eyebrow="Legal" title="Refund & Cancellation Policy" intro="Effective 6 November 2026. Simple rules for monthly plans.">
      <Prose>
        <H2>1. Cancelling your plan</H2>
        <p>You can cancel any time from <strong>Dashboard → Billing → Cancel at period end</strong>. Your plan stays active until the end of the month you have already paid for and will not renew. You can withdraw the cancellation before that date. Reports, documents and chat history remain available after your plan ends.</p>
        <H2>2. Monthly fees</H2>
        <p>Plans are monthly services paid in advance. Once a billing month has started, fees for that month are not refundable, including for unused listings or services, except as set out below.</p>
        <H2>3. When we refund</H2>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Duplicate or excess payment:</strong> the duplicate or excess amount is refunded in full.</li>
          <li><strong>Payment taken but plan not activated:</strong> if your payment is debited and your plan is not activated within 48 hours, we refund in full on request.</li>
          <li><strong>Service not started due to SOLLUNA:</strong> if we cannot begin any service within 7 days of activation for reasons on our side, you may request a full refund within the first 7 days.</li>
        </ul>
        <H2>4. What is never refundable by SOLLUNA</H2>
        <p>Advertising spend, marketplace fees, promotion and deal charges, and third-party costs are paid directly to those parties and are governed by their policies.</p>
        <H2>5. Plan changes</H2>
        <p>Switching to another plan (up or down) starts the new plan, and a new billing month, as soon as its payment is verified. The unused part of the previous plan&apos;s month is not refunded, so we recommend switching close to your renewal date. Renewing the same plan early simply extends your current period.</p>
        <H2>6. How refunds are paid</H2>
        <p>Approved refunds go back to the original payment method through Razorpay, usually within 7–10 business days. A GST credit note is issued against the original tax invoice.</p>
        <H2>7. Requests</H2>
        <p>Email <a className="underline" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> with your registered email and invoice number. We respond within 3 business days.</p>
      </Prose>
    </PageShell>
  );
}
