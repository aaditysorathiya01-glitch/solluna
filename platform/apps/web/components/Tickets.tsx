'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Empty, Flash, Modal, Status, dt, errText, formBody, human, mpName, useApi, type FlashMsg } from './ui';

interface Ticket {
  id: string; number: number; category: string; marketplace: string | null; subject: string; description: string; status: string; statusLabel: string;
  priority: string; assigneeId: string | null; createdAt: string; updatedAt: string; ackDueAt: string; ackOverdue: boolean; firstResponseAt: string | null;
  organization?: { legalName: string; brandName: string | null };
}
interface Comment { id: string; authorType: string; authorName: string; body: string; internal: boolean; statusFrom: string | null; statusTo: string | null; createdAt: string }
type TicketFull = Ticket & { comments: Comment[] };

export const TICKET_CATEGORIES: [string, string][] = [
  ['ACCOUNT_REGISTRATION', 'Account registration'], ['BRAND_APPROVAL', 'Brand approval'], ['CATALOG_MAPPING', 'Catalog mapping'], ['NEW_LISTING', 'New listing'],
  ['ADS', 'Advertising'], ['PROMOTIONS', 'Promotions'], ['INVENTORY', 'Inventory'], ['SHIPPING_LABELS', 'Shipping labels'], ['PAYMENTS_SETTLEMENTS', 'Payments & settlements'], ['ACCOUNT_HEALTH', 'Account health'],
];
const PRIORITY: Record<string, string> = { P1: 'Critical — business stopped (30 min)', P2: 'High (2 business hours)', P3: 'Normal (1 business day)', P4: 'Low (2 business days)' };
const prioChip = (p: string) => <span className={`chip ${p === 'P1' ? 'bg-red-600 text-white' : p === 'P2' ? 'bg-amber-50 text-amber-800' : 'bg-ink/5 text-ink-3'}`}>{p}</span>;
const OPEN = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'WAITING_FOR_MARKETPLACE'];

function Thread({ comments, staff }: { comments: Comment[]; staff: boolean }) {
  return (
    <ol className="space-y-3">
      {comments.map((c) => c.authorType === 'SYSTEM' || (c.statusTo && c.body.startsWith('Status changed')) ? (
        <li key={c.id} className="text-center text-xs text-ink-3">{c.body} · {dt(c.createdAt)}</li>
      ) : (
        <li key={c.id} className={`rounded-xl p-3 text-sm ${c.internal ? 'border border-dashed border-sun bg-sun/5' : c.authorType === 'CUSTOMER' ? 'bg-ivory' : 'bg-moon/5'}`}>
          <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <strong className="text-ink-2">{c.authorName}</strong>{dt(c.createdAt)}
            {c.statusTo && <Status s={c.statusTo} />}
            {c.internal && staff && <span className="chip bg-sun/20 text-sun-3">Internal note</span>}
          </p>
          <p className="whitespace-pre-line">{c.body}</p>
        </li>
      ))}
    </ol>
  );
}

// ───────────────────────── Client ─────────────────────────

export function ClientTickets() {
  const list = useApi<Ticket[]>('/tickets');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [flash, setFlash] = useState<FlashMsg>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="font-display text-3xl">Support tickets</h1><p className="text-sm text-ink-3">For issues that need tracking to resolution. Quick questions go to Manager Chat.</p></div>
        <button className="btn-primary" onClick={() => setCreating(true)}>New ticket</button>
      </div>
      <Flash msg={flash} onClose={() => setFlash(null)} />
      {list.error && <Flash msg={{ kind: 'err', text: list.error }} onClose={list.reload} />}
      <div className="space-y-2">
        {list.data?.map((t) => (
          <button key={t.id} onClick={() => setOpenId(t.id)} className="card flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left transition hover:border-sun">
            <div>
              <p className="font-semibold"><span className="text-ink-3">#{t.number}</span> {t.subject}</p>
              <p className="text-xs text-ink-3">{TICKET_CATEGORIES.find(([k]) => k === t.category)?.[1]}{t.marketplace ? ` · ${mpName(t.marketplace)}` : ''} · updated {dt(t.updatedAt)}</p>
            </div>
            <div className="flex items-center gap-2">{prioChip(t.priority)}<Status s={t.status} label={t.statusLabel} /></div>
          </button>
        ))}
        {list.data && !list.data.length && <Empty>No tickets yet.</Empty>}
      </div>
      {creating && <NewTicket onClose={() => setCreating(false)} onCreated={(t) => { setCreating(false); setFlash({ kind: 'ok', text: `Ticket #${t.number} created. First response due by ${dt(t.ackDueAt)}.` }); list.reload(); }} />}
      {openId && <ClientTicketView id={openId} onClose={() => { setOpenId(null); list.reload(); }} />}
    </div>
  );
}

function NewTicket({ onClose, onCreated }: { onClose: () => void; onCreated: (t: Ticket) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null);
    try { onCreated(await api<Ticket>('/tickets', { method: 'POST', body: formBody(e.currentTarget) })); }
    catch (err) { setError(errText(err)); setBusy(false); }
  }
  return (
    <Modal title="New support ticket" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="t-cat">Category</label><select id="t-cat" name="category" className="input" required>{TICKET_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="label" htmlFor="t-mp">Marketplace</label><select id="t-mp" name="marketplace" className="input"><option value="">Both / not specific</option><option value="AMAZON">Amazon</option><option value="FLIPKART">Flipkart</option></select></div>
        </div>
        <div><label className="label" htmlFor="t-sub">Subject</label><input id="t-sub" name="subject" className="input" required minLength={4} placeholder="e.g. Listing suppressed for SKU BD-4" /></div>
        <div><label className="label" htmlFor="t-desc">Describe the issue</label><textarea id="t-desc" name="description" className="input min-h-28" required minLength={10} placeholder="What happened, order IDs / SKUs, since when…" /></div>
        <div><label className="label" htmlFor="t-pri">Urgency</label><select id="t-pri" name="priority" className="input" defaultValue="P3">{Object.entries(PRIORITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create ticket'}</button></div>
      </form>
    </Modal>
  );
}

function ClientTicketView({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useApi<TicketFull>(`/tickets/${id}`);
  const [error, setError] = useState<string | null>(null);
  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); await t.reload(); } catch (e) { setError(errText(e)); }
  }
  if (!t.data) return <Modal title="Ticket" onClose={onClose}><p className="text-sm text-ink-3">{t.error ?? 'Loading…'}</p></Modal>;
  const x = t.data;
  return (
    <Modal title={`#${x.number} · ${x.subject}`} onClose={onClose}>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-3">{prioChip(x.priority)}<Status s={x.status} label={x.statusLabel} /><span>Opened {dt(x.createdAt)}</span>{!x.firstResponseAt && OPEN.includes(x.status) && <span>· response due {dt(x.ackDueAt)}</span>}</div>
      <p className="mb-4 whitespace-pre-line rounded-xl bg-ivory p-3 text-sm">{x.description}</p>
      <Thread comments={x.comments} staff={false} />
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {x.status !== 'CLOSED' && (
        <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const b = formBody(f); act(async () => { await api(`/tickets/${id}/comments`, { method: 'POST', body: b }); f.reset(); }); }}>
          <label className="label" htmlFor="c-body">Reply</label>
          <textarea id="c-body" name="body" className="input min-h-20" required />
          <div className="flex flex-wrap justify-end gap-2">
            {x.status === 'RESOLVED' && <button type="button" className="btn-ghost" onClick={() => act(() => api(`/tickets/${id}/action`, { method: 'POST', body: { action: 'CLOSE' } }))}>Confirm resolved & close</button>}
            <button className="btn-primary">Send reply</button>
          </div>
        </form>
      )}
      {(x.status === 'RESOLVED' || x.status === 'CLOSED') && (
        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); const b = formBody(e.currentTarget); act(() => api(`/tickets/${id}/action`, { method: 'POST', body: { action: 'REOPEN', note: b.note } })); }}>
          <input name="note" className="input" placeholder="Still not fixed? Tell us what's wrong" aria-label="Reason to reopen" required />
          <button className="btn-ghost whitespace-nowrap">Reopen</button>
        </form>
      )}
    </Modal>
  );
}

// ───────────────────────── Staff ─────────────────────────

const STAFF_STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'WAITING_FOR_MARKETPLACE', 'RESOLVED', 'CLOSED'];

export function OpsTickets({ staff }: { staff: { id: string; name: string; staffRole: string }[] }) {
  const [filter, setFilter] = useState('');
  const list = useApi<Ticket[]>(`/ops/tickets${filter ? `?status=${filter}` : ''}`);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-display text-2xl">Support tickets</h1>
          <div className="flex gap-2">
            <select className="input py-1.5 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter tickets">
              <option value="">Open</option><option value="ALL">All</option>{STAFF_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}
            </select>
            <button className="btn-ghost py-1.5 text-xs" onClick={list.reload}>Refresh</button>
          </div>
        </div>
        {list.error && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{list.error}</p>}
        <ul className="space-y-2">
          {list.data?.map((t) => (
            <li key={t.id}>
              <button onClick={() => setOpenId(t.id)} className={`card w-full p-4 text-left transition hover:border-sun ${openId === t.id ? 'border-sun ring-1 ring-sun' : ''}`}>
                <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold">#{t.number} {t.subject}</p>{prioChip(t.priority)}</div>
                <p className="mt-1 text-xs text-ink-3">{t.organization?.brandName ?? t.organization?.legalName} · {human(t.category)}{t.marketplace ? ` · ${mpName(t.marketplace)}` : ''}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2"><Status s={t.status} />{t.ackOverdue && <span className="chip bg-red-600 text-white">SLA overdue</span>}{!t.firstResponseAt && !t.ackOverdue && OPEN.includes(t.status) && <span className="text-[11px] text-ink-3">respond by {dt(t.ackDueAt)}</span>}</div>
              </button>
            </li>
          ))}
          {list.data && !list.data.length && <li><Empty>No tickets in this view.</Empty></li>}
        </ul>
      </section>
      <section>{openId ? <OpsTicketView key={openId} id={openId} staff={staff} onChanged={list.reload} /> : <Empty>Select a ticket.</Empty>}</section>
    </main>
  );
}

function OpsTicketView({ id, staff, onChanged }: { id: string; staff: { id: string; name: string; staffRole: string }[]; onChanged: () => void }) {
  const t = useApi<TicketFull>(`/ops/tickets/${id}`);
  const [flash, setFlash] = useState<FlashMsg>(null);
  async function act(fn: () => Promise<unknown>, ok: string, form?: HTMLFormElement) {
    setFlash(null);
    try { await fn(); form?.reset(); await t.reload(); onChanged(); setFlash({ kind: 'ok', text: ok }); } catch (e) { setFlash({ kind: 'err', text: errText(e) }); }
  }
  if (!t.data) return <Empty>{t.error ?? 'Loading…'}</Empty>;
  const x = t.data;
  return (
    <div className="card space-y-4 p-6">
      <div>
        <p className="text-xs text-ink-3">{x.organization?.brandName ?? x.organization?.legalName} · opened {dt(x.createdAt)}</p>
        <h2 className="font-display text-xl">#{x.number} {x.subject}</h2>
        <div className="mt-2 flex flex-wrap gap-2">{prioChip(x.priority)}<Status s={x.status} />{x.ackOverdue && <span className="chip bg-red-600 text-white">SLA overdue</span>}</div>
      </div>
      <p className="whitespace-pre-line rounded-xl bg-ivory p-3 text-sm">{x.description}</p>
      <form className="grid gap-3 rounded-xl border border-ink/10 p-4 sm:grid-cols-3" onSubmit={(e) => {
        e.preventDefault(); const f = e.currentTarget; const b = formBody(f) as Record<string, string>;
        const body: Record<string, unknown> = {};
        if (b.status && b.status !== x.status) body.status = b.status;
        if (b.priority && b.priority !== x.priority) body.priority = b.priority;
        if ((b.assigneeId ?? '') !== (x.assigneeId ?? '')) body.assigneeId = b.assigneeId || null;
        if (b.note) body.note = b.note;
        act(() => api(`/ops/tickets/${id}`, { method: 'PATCH', body }), 'Ticket updated — client notified of status changes.', f);
      }}>
        <div><label className="label" htmlFor="o-status">Status</label><select id="o-status" name="status" className="input" defaultValue={x.status}>{STAFF_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}</select></div>
        <div><label className="label" htmlFor="o-pri">Priority</label><select id="o-pri" name="priority" className="input" defaultValue={x.priority}>{['P1', 'P2', 'P3', 'P4'].map((p) => <option key={p}>{p}</option>)}</select></div>
        <div><label className="label" htmlFor="o-asg">Assignee</label><select id="o-asg" name="assigneeId" className="input" defaultValue={x.assigneeId ?? ''}><option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {human(s.staffRole)}</option>)}</select></div>
        <div className="sm:col-span-3"><label className="label" htmlFor="o-note">Note to client (required for Resolved / Waiting for client)</label><input id="o-note" name="note" className="input" /></div>
        <div className="sm:col-span-3"><button className="btn-primary">Update ticket</button></div>
      </form>
      <Flash msg={flash} onClose={() => setFlash(null)} />
      <Thread comments={x.comments} staff />
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const b = formBody(f); act(() => api(`/ops/tickets/${id}/comments`, { method: 'POST', body: { body: b.body, internal: b.internal === 'on' } }), 'Sent.', f); }}>
        <label className="label" htmlFor="o-reply">Reply</label>
        <textarea id="o-reply" name="body" className="input min-h-20" required />
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="internal" /> Internal note (staff only)</label>
          <button className="btn-primary">Send</button>
        </div>
      </form>
    </div>
  );
}
