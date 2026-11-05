'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Logo } from './Logo';
import { Status } from './Dashboard';

interface QueueTask { id: string; title: string; status: string; priority: string; skill: string; featureKey: string; marketplace: string | null; organization: { legalName: string; brandName: string | null }; request: { title: string } | null; createdAt: string }
interface Context {
  task: QueueTask & { blocker: string | null; evidence: Record<string, unknown> | null; requiredInputs: Record<string, unknown> | null };
  client: { legalName: string; brandName: string | null; plan: { code: string; name: string } | null };
  skill: { name: string; description: string; instructions: string };
  connectors: string[];
  completionRequirements: { approvedOutputHosts: string[]; outcomes: string[] | null; approvalParametersRequired: boolean };
  allowedTransitions: string[];
}

const CONNECTOR_LABEL: Record<string, string> = { GOOGLE_DRIVE: 'Google Drive', GOOGLE_SHEETS: 'Google Sheets', ZAPIER_GMAIL: 'Gmail (Zapier)', CLAUDE_DOCS: 'Claude Docs' };
const NEEDS_BLOCKER = ['BLOCKED', 'AWAITING_INFORMATION', 'PARTIALLY_COMPLETED'];
const NEEDS_EVIDENCE = ['COMPLETED', 'PARTIALLY_COMPLETED'];

export function Ops() {
  const router = useRouter();
  const [me, setMe] = useState<{ name: string; staffRole: string } | null>(null);
  const [queue, setQueue] = useState<QueueTask[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      const m = await api<{ user: { name: string; type: string; staffRole: string } }>('/auth/me');
      if (m.user.type !== 'STAFF') { router.replace('/dashboard'); return; }
      setMe(m.user);
      setQueue(await api<QueueTask[]>('/ops/tasks'));
    } catch (e) {
      if ((e as ApiError).status === 401) router.replace('/login'); else setError((e as Error).message);
    }
  }, [router]);

  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => {
    if (!selected) { setCtx(null); return; }
    api<Context>(`/ops/tasks/${selected}/context`).then(setCtx).catch((e) => setError(e.message));
  }, [selected]);

  if (!me) return <main className="flex min-h-screen items-center justify-center text-ink-3">{error ?? 'Loading…'}</main>;

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink/10 bg-ink">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4"><Logo light /><span className="chip bg-sun/20 text-sun-2">Operations</span></div>
          <div className="flex items-center gap-3 text-sm text-ivory/70">
            <span className="hidden sm:inline">{me.name} · {me.staffRole.replace(/_/g, ' ').toLowerCase()}</span>
            <button className="btn border border-ivory/20 py-1.5 text-ivory" onClick={async () => { await api('/auth/logout', { method: 'POST' }); router.replace('/login'); }}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section>
          <div className="mb-3 flex items-center justify-between"><h1 className="font-display text-2xl">Task queue</h1><button className="btn-ghost py-1.5 text-xs" onClick={loadQueue}>Refresh</button></div>
          {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <ul className="space-y-2">
            {queue.map((t) => (
              <li key={t.id}>
                <button onClick={() => { setSelected(t.id); setError(null); }} className={`card w-full p-4 text-left transition hover:border-sun ${selected === t.id ? 'border-sun ring-1 ring-sun' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{t.title}</p>
                    <span className={`chip ${t.priority === 'P1' ? 'bg-red-50 text-red-800' : t.priority === 'P2' ? 'bg-amber-50 text-amber-800' : 'bg-ink/5 text-ink-3'}`}>{t.priority}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-3">{t.organization.brandName ?? t.organization.legalName}{t.marketplace ? ` · ${t.marketplace}` : ''} · {t.skill}</p>
                  <div className="mt-2"><Status s={t.status} /></div>
                </button>
              </li>
            ))}
            {!queue.length && <li className="card p-6 text-sm text-ink-3">No open tasks for your role.</li>}
          </ul>
        </section>
        <section>{ctx ? <TaskPanel ctx={ctx} onChanged={async () => { await loadQueue(); setCtx(await api<Context>(`/ops/tasks/${ctx.task.id}/context`)); }} /> : <div className="card p-10 text-center text-sm text-ink-3">Select a task to see its client, skill procedure and completion requirements.</div>}</section>
      </main>
    </div>
  );
}

function TaskPanel({ ctx, onChanged }: { ctx: Context; onChanged: () => Promise<void> }) {
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSkill, setShowSkill] = useState(false);
  const req = ctx.completionRequirements;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!target) return;
    const f = new FormData(e.currentTarget);
    const val = (k: string) => (String(f.get(k) ?? '').trim() || undefined);
    let approvalParameters: Record<string, unknown> | undefined;
    if (val('approvalParameters')) {
      try { approvalParameters = JSON.parse(val('approvalParameters')!); } catch { setError('Approval parameters must be valid JSON, e.g. {"dailyBudgetInr": 500}'); return; }
    }
    const evidence = NEEDS_EVIDENCE.includes(target)
      ? Object.fromEntries(Object.entries({ summary: val('summary'), outputUrl: val('outputUrl'), marketplaceRef: val('marketplaceRef'), outcome: val('outcome'), catalogId: val('catalogId'), confidence: val('confidence'), approvalParameters }).filter(([, v]) => v !== undefined))
      : undefined;
    setBusy(true); setError(null);
    try {
      await api(`/ops/tasks/${ctx.task.id}`, { method: 'PATCH', body: { status: target, blocker: val('blocker'), evidence } });
      setTarget(null);
      await onChanged();
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="label">Task</p><h2 className="font-display text-2xl">{ctx.task.title}</h2></div>
          <Status s={ctx.task.status} />
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="label">Client</dt><dd>{ctx.client.brandName ?? ctx.client.legalName}</dd></div>
          <div><dt className="label">Plan</dt><dd>{ctx.client.plan?.name ?? 'No active plan'}</dd></div>
          <div><dt className="label">Request</dt><dd>{ctx.task.request?.title ?? '—'}</dd></div>
          <div><dt className="label">Use connectors</dt><dd className="flex flex-wrap gap-1">{ctx.connectors.map((c) => <span key={c} className="chip bg-moon/10 text-moon">{CONNECTOR_LABEL[c] ?? c}</span>)}</dd></div>
        </dl>
        {ctx.task.requiredInputs && Object.keys(ctx.task.requiredInputs).length > 0 && (
          <div className="mt-4 rounded-xl bg-ivory p-3 text-xs"><p className="label">Client details</p><pre className="whitespace-pre-wrap font-sans">{JSON.stringify(ctx.task.requiredInputs, null, 2)}</pre></div>
        )}
        {ctx.task.blocker && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{ctx.task.blocker}</p>}
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between gap-2">
          <div><p className="label">Skill</p><p className="font-mono text-sm">{ctx.skill.name}</p></div>
          <button className="btn-ghost py-1.5 text-xs" onClick={() => setShowSkill(!showSkill)}>{showSkill ? 'Hide procedure' : 'Show procedure'}</button>
        </div>
        <p className="mt-2 text-sm text-ink-3">{ctx.skill.description}</p>
        {showSkill && <pre className="mt-4 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl bg-ivory p-4 text-xs leading-relaxed">{ctx.skill.instructions}</pre>}
      </div>

      <div className="card p-6">
        <p className="label">Move task</p>
        <div className="flex flex-wrap gap-2">
          {ctx.allowedTransitions.map((s) => <button key={s} onClick={() => { setTarget(s); setError(null); }} className={target === s ? 'btn-primary py-1.5 text-xs' : 'btn-ghost py-1.5 text-xs'}>{s.replace(/_/g, ' ').toLowerCase()}</button>)}
          {!ctx.allowedTransitions.length && <p className="text-sm text-ink-3">{ctx.task.status === 'AWAITING_CLIENT_APPROVAL' ? 'Waiting for the client to approve. Staff cannot approve on their behalf.' : 'No manual transitions from this status.'}</p>}
        </div>
        {target && (
          <form onSubmit={submit} className="mt-5 space-y-3">
            {NEEDS_EVIDENCE.includes(target) && (
              <>
                <div><label className="label" htmlFor="summary">What was verified *</label><textarea id="summary" name="summary" className="input min-h-20" required minLength={10} /></div>
                {target === 'COMPLETED' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className="label" htmlFor="outputUrl">Delivery link ({req.approvedOutputHosts.join(', ')})</label><input id="outputUrl" name="outputUrl" className="input" placeholder="https://drive.google.com/…" /></div>
                    <div><label className="label" htmlFor="marketplaceRef">or marketplace confirmation</label><input id="marketplaceRef" name="marketplaceRef" className="input" placeholder="Case / feed / campaign ID" /></div>
                  </div>
                )}
                {req.outcomes && target === 'COMPLETED' && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div><label className="label" htmlFor="outcome">Outcome *</label><select id="outcome" name="outcome" className="input" required>{req.outcomes.map((o) => <option key={o}>{o}</option>)}</select></div>
                    <div><label className="label" htmlFor="catalogId">ASIN / FSN</label><input id="catalogId" name="catalogId" className="input" /></div>
                    <div><label className="label" htmlFor="confidence">Match confidence</label><select id="confidence" name="confidence" className="input"><option value="">—</option><option>EXACT_VERIFIED</option><option>HIGH_CONFIDENCE</option><option>REVIEW_REQUIRED</option></select></div>
                  </div>
                )}
                {req.approvalParametersRequired && target === 'COMPLETED' && (
                  <div><label className="label" htmlFor="approvalParameters">Parameters the client must approve (JSON) *</label><textarea id="approvalParameters" name="approvalParameters" className="input min-h-16 font-mono text-xs" placeholder='{"dailyBudgetInr": 500, "durationDays": 30}' /></div>
                )}
              </>
            )}
            {NEEDS_BLOCKER.includes(target) && <div><label className="label" htmlFor="blocker">{target === 'AWAITING_INFORMATION' ? 'What the client must provide *' : 'Blocker *'}</label><input id="blocker" name="blocker" className="input" required minLength={3} /></div>}
            {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
            <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : `Confirm: ${target.replace(/_/g, ' ').toLowerCase()}`}</button>
          </form>
        )}
      </div>
    </div>
  );
}
