import { Suspense } from 'react';
import { Dashboard } from '@/components/Dashboard';

export default function Page() {
  return <Suspense fallback={<main className="p-10 text-ink-3">Loading…</main>}><Dashboard /></Suspense>;
}
