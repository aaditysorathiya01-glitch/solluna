'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

interface Party { legalName: string; tradeName?: string; brandName?: string | null; gstin: string | null; pan?: string; address: string; city?: string; pincode?: string; stateCode: string; stateName: string; email?: string | null; phone?: string }
interface Invoice {
  id: string; number: string; issuedAt: string; sac: string; description: string; periodStart: string; periodEnd: string;
  placeOfSupply: string; placeOfSupplyName: string; intraState: boolean; gstRateBps: number;
  taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; gstPaise: number; amountPaise: number;
  supplier: Party; buyer: Party; amountInWords: string; reverseCharge: string;
}

const rs = (paise: number) => (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** GST tax invoice (CGST Rule 46). "Download PDF" uses the browser's print-to-PDF: no extra dependency. */
export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Invoice>(`/billing/invoices/${id}`)
      .catch((e: ApiError) => (e.status === 403 ? api<Invoice>(`/billing/admin/invoices/${id}`) : Promise.reject(e)))
      .then(setInv)
      .catch((e: ApiError) => (e.status === 401 ? router.replace('/login') : setError(e.message)));
  }, [id, router]);

  if (error) return <main className="p-10 text-center text-ink-3">{error}</main>;
  if (!inv) return <main className="p-10 text-center text-ink-3">Loading invoice…</main>;
  const rate = inv.gstRateBps / 100;
  const s = inv.supplier, b = inv.buyer;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 print:max-w-none print:p-0">
      <div className="mb-4 flex justify-between print:hidden">
        <button className="btn-ghost py-1.5 text-xs" onClick={() => router.back()}>← Back</button>
        <button className="btn-primary py-1.5 text-xs" onClick={() => window.print()}>Download PDF / Print</button>
      </div>
      <article className="card p-8 text-sm print:border-0 print:shadow-none" aria-label="Tax invoice">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-ink/15 pb-6">
          <div>
            <p className="font-display text-2xl tracking-[0.15em]">{s.tradeName ?? 'SOLLUNA'}</p>
            <p className="mt-1 font-semibold">{s.legalName}</p>
            <p className="text-ink-3">{s.address}</p>
            <p className="text-ink-3">GSTIN <strong className="text-ink">{s.gstin}</strong> · PAN {s.pan}</p>
            <p className="text-ink-3">State: {s.stateName} ({s.stateCode}){s.email ? ` · ${s.email}` : ''}</p>
          </div>
          <div className="text-right">
            <h1 className="text-lg font-bold uppercase tracking-wider">Tax Invoice</h1>
            <p className="text-xs text-ink-3">Original for recipient</p>
            <dl className="mt-3 space-y-0.5">
              <div><dt className="inline text-ink-3">Invoice no. </dt><dd className="inline font-semibold">{inv.number}</dd></div>
              <div><dt className="inline text-ink-3">Date </dt><dd className="inline">{new Date(inv.issuedAt).toLocaleDateString('en-IN')}</dd></div>
              <div><dt className="inline text-ink-3">Place of supply </dt><dd className="inline">{inv.placeOfSupplyName} ({inv.placeOfSupply})</dd></div>
              <div><dt className="inline text-ink-3">Reverse charge </dt><dd className="inline">{inv.reverseCharge}</dd></div>
            </dl>
          </div>
        </header>

        <section className="border-b border-ink/15 py-5">
          <p className="label">Bill to</p>
          <p className="font-semibold">{b.legalName}{b.brandName ? ` (${b.brandName})` : ''}</p>
          <p className="text-ink-3">{b.address}{b.city ? `, ${b.city}` : ''}{b.pincode ? ` ${b.pincode}` : ''}</p>
          <p className="text-ink-3">State: {b.stateName} ({b.stateCode}) · {b.gstin ? <>GSTIN <strong className="text-ink">{b.gstin}</strong></> : 'Unregistered recipient'}</p>
        </section>

        <div className="overflow-x-auto">
          <table className="mt-5 w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-ink/15 text-left text-xs uppercase tracking-wider text-ink-3">
                <th className="py-2">#</th><th>Description of service</th><th>SAC</th><th className="text-right">Qty</th><th className="text-right">Taxable value (₹)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-ink/10 align-top">
                <td className="py-3">1</td><td className="pr-4">{inv.description}</td><td>{inv.sac}</td><td className="text-right">1</td><td className="text-right">{rs(inv.taxablePaise)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <dl className="w-full max-w-xs space-y-1">
            <Row k="Taxable value" v={rs(inv.taxablePaise)} />
            {inv.intraState ? (<><Row k={`CGST @ ${rate / 2}%`} v={rs(inv.cgstPaise)} /><Row k={`SGST @ ${rate / 2}%`} v={rs(inv.sgstPaise)} /></>) : <Row k={`IGST @ ${rate}%`} v={rs(inv.igstPaise)} />}
            <Row k="Total tax" v={rs(inv.gstPaise)} />
            <div className="flex justify-between border-t border-ink/20 pt-2 text-base font-bold"><dt>Invoice total</dt><dd>₹{rs(inv.amountPaise)}</dd></div>
          </dl>
        </div>
        <p className="mt-4 text-xs"><span className="text-ink-3">Amount in words: </span><strong>{inv.amountInWords}</strong></p>

        <footer className="mt-10 flex flex-wrap items-end justify-between gap-6 border-t border-ink/15 pt-5 text-xs text-ink-3">
          <p className="max-w-md">Service period {new Date(inv.periodStart).toLocaleDateString('en-IN')} to {new Date(inv.periodEnd).toLocaleDateString('en-IN')}. Paid online via Razorpay. This is a computer-generated invoice and does not require a physical signature.</p>
          <p className="text-right">For <strong className="text-ink">{s.legalName}</strong><br /><br />Authorised Signatory</p>
        </footer>
      </article>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><dt className="text-ink-3">{k}</dt><dd>₹{v}</dd></div>;
}
