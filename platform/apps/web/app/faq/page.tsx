import Link from 'next/link';
import type { Metadata } from 'next';
import { PageShell } from '@/components/Site';
import { FAQS } from '@/lib/faq';

export const metadata: Metadata = { title: 'FAQ — SOLLUNA', description: 'Answers on GST invoices, listing limits, ad spend, passwords, labels, reporting and cancellations.' };

export default function Faq() {
  return (
    <PageShell eyebrow="FAQ" title="Questions sellers ask before they start." intro="Straight answers. If yours isn’t here, ask us directly.">
      <div className="max-w-3xl divide-y divide-ink/10 rounded-2xl border border-ink/10 bg-white">
        {FAQS.map(([q, a]) => (
          <details key={q} className="group p-5 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
              {q}<span className="text-sun transition group-open:rotate-45" aria-hidden>+</span>
            </summary>
            <p className="mt-3 text-sm leading-6 text-ink-3">{a}</p>
          </details>
        ))}
      </div>
      <p className="mt-8 text-sm text-ink-3">Still unsure? <Link className="font-semibold text-ink underline" href="/contact">Contact us</Link> — we reply within one business day.</p>
    </PageShell>
  );
}
