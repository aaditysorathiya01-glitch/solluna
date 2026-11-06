'use client';
import { use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { NotePreview, type Template } from '@/components/Fulfilment';

interface Sheet { job: { id: string; marketplace: string; batchDate: string; count: number }; template: Template }

/** Print sheet: one thank-you insert per order, each on its own page at the template's exact size. */
export default function NotesPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const ops = useSearchParams().get('ops') === '1';
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Sheet>(`${ops ? '/ops' : ''}/labels/${id}/notes`).then(setSheet).catch((e) => setError((e as Error).message)); }, [id, ops]);
  if (error) return <main className="p-10 text-sm text-red-800">{error}</main>;
  if (!sheet) return <main className="p-10 text-sm text-ink-3">Preparing print sheet…</main>;
  const t = sheet.template;
  return (
    <main className="bg-ivory-2 print:bg-white">
      <style>{`@page { size: ${t.widthMm}mm ${t.heightMm}mm; margin: 0; } @media print { .no-print { display: none !important; } .sheet { break-after: page; } }`}</style>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 bg-white px-6 py-4">
        <div>
          <p className="font-semibold">{sheet.job.count} thank-you inserts · {sheet.job.marketplace === 'AMAZON' ? 'Amazon' : 'Flipkart'} · {new Date(sheet.job.batchDate).toLocaleDateString('en-IN')}</p>
          <p className="text-xs text-ink-3">{t.name} v{t.version} · {t.widthMm} × {t.heightMm} mm · print at 100% scale (no &quot;fit to page&quot;). Separate inserts — not printed on the shipping label.</p>
        </div>
        <button className="btn-primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <div className="flex flex-col items-center gap-6 py-8 print:block print:p-0">
        {Array.from({ length: sheet.job.count }, (_, i) => <div key={i} className="sheet shadow-md print:shadow-none"><NotePreview t={t} /></div>)}
      </div>
    </main>
  );
}
