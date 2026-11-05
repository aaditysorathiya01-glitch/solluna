'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Logo } from './Logo';
import { Status } from './Dashboard';
import { ChatPanel, DocumentsPanel } from './Chat';

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
  const [view, setView] = useState<'tasks' | 'inbox'>('tasks');

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
      <nav className="mx-auto flex max-w-7xl gap-1 px-4 pt-4 sm:px-6" aria-label="Operations">
        {(['tasks', 'inbox'] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={view === v ? 'btn-primary py-1.5 text-xs' : 'btn-ghost py-1.5 text-xs'}>{v === 'tasks' ? 'Task queue' : 'Client inbox'}</button>
        ))}
      </nav>
      {view === 'inbox' ? <Inbox canAssign={['SUPER_ADMIN', 'OPERATIONS_MANAGER'].includes(me.staffRole)} /> : (
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
      )}
    </div>
  );
}

interface InboxRow { organizationId: string; name: string; unread: number; waitingMinutes: number; overdue: boolean; managers: { id: string; name: string }[]; last: { body: string; senderType: string; createdAt: string } | null }

function Inbox({ canAssign }: { canAssign: boolean }) {
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [org, setOrg] = useState<string | null>(null);
  const [side, setSide] = useState<'request' | 'documents' | null>(null);
  const load = useCallback(() => api<InboxRow[]>('/ops/chats').then(setRows).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const current = rows.find((r) => r.organizationId === org);
  const wait = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`);
  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <section>
        <h1 className="mb-3 font-display text-2xl">Client inbox</h1>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.organizationId}>
              <button onClick={() => { setOrg(r.organizationId); setSide(null); }} className={`card w-full p-4 text-left hover:border-sun ${org === r.organizationId ? 'border-sun ring-1 ring-sun' : ''}`} data-testid="inbox-row">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{r.name}</p>
                  {r.unread > 0 && <span className={`chip ${r.overdue ? 'bg-red-50 text-red-800' : 'bg-sun text-ink'}`}>{r.unread} new · {wait(r.waitingMinutes)}</span>}
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-ink-3">{r.last ? `${r.last.senderType === 'CUSTOMER' ? '' : 'You: '}${r.last.body || 'Attachment'}` : 'No messages yet'}</p>
                <p className="mt-1 text-[11px] text-ink-3">Manager: {r.managers.map((m) => m.name).join(', ') || 'Unassigned'}</p>
              </button>
            </li>
          ))}
          {!rows.length && <li className="card p-6 text-sm text-ink-3">No client conversations assigned to you.</li>}
        </ul>
      </section>
      <section className="space-y-4">
        {org && current ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl">{current.name}</h2>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost py-1.5 text-xs" onClick={() => setSide(side === 'request' ? null : 'request')}>Log request</button>
                <button className="btn-ghost py-1.5 text-xs" onClick={() => setSide(side === 'documents' ? null : 'documents')}>Documents</button>
                {canAssign && <AssignManager orgId={org} onDone={load} />}
              </div>
            </div>
            {side === 'request' && <LogRequest orgId={org} onDone={() => setSide(null)} />}
            {side === 'documents' && <DocumentsPanel orgId={org} staff />}
            <ChatPanel key={org} mode="staff" orgId={org} onActivity={load} />
          </>
        ) : <div className="card p-10 text-center text-sm text-ink-3">Select a client conversation.</div>}
      </section>
    </main>
  );
}

function AssignManager({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [staff, setStaff] = useState<{ id: string; name: string; staffRole: string }[]>([]);
  useEffect(() => { api<typeof staff>('/admin/staff').then(setStaff).catch(() => {}); }, []);
  return (
    <select aria-label="Assign manager" className="input w-auto py-1.5 text-xs" defaultValue="" onChange={async (e) => {
      if (!e.target.value) return;
      await api(`/admin/clients/${orgId}/managers`, { method: 'POST', body: { managerId: e.target.value } });
      e.target.value = '';
      onDone();
    }}>
      <option value="">Assign manager…</option>
      {staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.staffRole.replace(/_/g, ' ').toLowerCase()}</option>)}
    </select>
  );
}

function LogRequest({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<{ key: string; label: string }[]>([]);
  // The 28 services, straight from the API's plan catalog (single source of truth).
  useEffect(() => { api<{ features: { key: string; label: string }[] }[]>('/plans').then((p) => setOptions(p[0]?.features ?? [])).catch(() => {}); }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    try {
      const r = await api<{ update: { text: string; sections: { status: string } } }>(`/ops/chats/${orgId}/requests`, {
        method: 'POST', body: { featureKey: f.get('featureKey'), title: f.get('title'), marketplace: f.get('marketplace') || undefined, priority: f.get('priority'), details: { source: 'chat', notes: f.get('notes') } },
      });
      setResult(`Logged. Status: ${r.update.sections.status}. The client has been told in chat.`);
      setTimeout(onDone, 1500);
    } catch (err) { setError((err as Error).message); }
  }
  return (
    <form onSubmit={submit} className="card grid gap-3 p-5 sm:grid-cols-2" aria-label="Log request from chat">
      <div className="sm:col-span-2"><label className="label" htmlFor="lr-title">Request</label><input id="lr-title" name="title" className="input" required minLength={3} /></div>
      <div><label className="label" htmlFor="lr-feature">Service</label><select id="lr-feature" name="featureKey" className="input">{options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label" htmlFor="lr-mp">Marketplace</label><select id="lr-mp" name="marketplace" className="input"><option value="">—</option><option value="AMAZON">Amazon</option><option value="FLIPKART">Flipkart</option></select></div>
        <div><label className="label" htmlFor="lr-priority">Priority</label><select id="lr-priority" name="priority" className="input" defaultValue="P3"><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select></div>
      </div>
      <div className="sm:col-span-2"><label className="label" htmlFor="lr-notes">Details</label><textarea id="lr-notes" name="notes" className="input min-h-16" /></div>
      {(error || result) && <p role={error ? 'alert' : 'status'} className={`text-sm sm:col-span-2 ${error ? 'text-red-800' : 'text-emerald-800'}`}>{error ?? result}</p>}
      <button className="btn-primary sm:col-span-2 sm:justify-self-start">Log request</button>
    </form>
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
