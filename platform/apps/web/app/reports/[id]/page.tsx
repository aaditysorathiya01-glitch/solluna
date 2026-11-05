'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { ReportView } from '@/components/ReportView';

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [report, setReport] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [base, setBase] = useState(`/reports/${id}`);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api(`/reports/${id}`)
      .catch((e: ApiError) => { if (e.status === 403) { setBase(`/ops/reports/view/${id}`); return api(`/ops/reports/view/${id}`); } throw e; })
      .then(setReport)
      .catch((e: ApiError) => (e.status === 401 ? router.replace('/login') : setError(e.message)));
  }, [id, router]);
  if (error) return <main className="p-10 text-center text-ink-3">{error}</main>;
  if (!report) return <main className="p-10 text-center text-ink-3">Loading report…</main>;
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 print:max-w-none print:p-0">
      <div className="mb-4 flex flex-wrap justify-between gap-2 print:hidden">
        <button className="btn-ghost py-1.5 text-xs" onClick={() => router.back()}>← Back</button>
        <div className="flex gap-2">
          <a className="btn-ghost py-1.5 text-xs" href={`/api${base}/export.csv`}>Download Excel (CSV)</a>
          <button className="btn-primary py-1.5 text-xs" onClick={() => window.print()}>Download PDF / Print</button>
        </div>
      </div>
      <ReportView report={report} />
    </main>
  );
}
