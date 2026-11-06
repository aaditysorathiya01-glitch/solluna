'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Empty, Flash, Modal, Status, d, dt, errText, mpName, useApi, type FlashMsg } from './ui';

export interface LabelJob { id: string; marketplace: string; batchDate: string; status: string; orderCount: number; noteCount: number; skippedOrders: { text?: string } | null; dispatchBy: string | null; note: string | null; downloadedAt: string | null; completedAt: string | null }
export interface Template { id: string; name: string; brandName: string; message: string; supportContact: string | null; website: string | null; colors: { primary: string; background: string; text: string }; widthMm: number; heightMm: number; logoKey: string | null; logoUrl: string | null; status: string; version: number; revisionNote: string | null; approvedAt: string | null; updatedAt: string }
interface StockRow { id: string; sku: string; name: string; sellable: number; inbound: number | null; avgDailySales: number | null; daysOfCover: number | null; severity: string | null; acknowledgedAt: string | null }
interface StockSnap { snapshotId: string; dataAsOf: string; stale: boolean; rows: StockRow[] }
export interface Inventory { included: boolean; thresholds: Record<string, string>; marketplaces: Record<string, StockSnap | null> }

/** The printed insert, at true size. Used for on-screen proofs and the print sheet. */
export function NotePreview({ t, scale = 1 }: { t: Pick<Template, 'brandName' | 'message' | 'supportContact' | 'website' | 'colors' | 'widthMm' | 'heightMm' | 'logoUrl'>; scale?: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center overflow-hidden text-center"
      style={{ width: `${t.widthMm * scale}mm`, height: `${t.heightMm * scale}mm`, background: t.colors.background, color: t.colors.text, padding: `${8 * scale}mm`, border: `${0.6 * scale}mm solid ${t.colors.primary}`, boxSizing: 'border-box' }}
    >
      {t.logoUrl && <img src={t.logoUrl} alt="" style={{ maxHeight: `${22 * scale}mm`, maxWidth: '70%', objectFit: 'contain', marginBottom: `${5 * scale}mm` }} />}
      <p style={{ fontFamily: 'Georgia, serif', fontSize: `${7 * scale}mm`, color: t.colors.primary, letterSpacing: '0.08em', lineHeight: 1.1 }}>{t.brandName}</p>
      <div style={{ width: `${18 * scale}mm`, height: `${0.5 * scale}mm`, background: t.colors.primary, margin: `${5 * scale}mm 0` }} />
      <p style={{ fontSize: `${3.6 * scale}mm`, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{t.message}</p>
      {(t.supportContact || t.website) && (
        <p style={{ fontSize: `${2.8 * scale}mm`, marginTop: `${6 * scale}mm`, opacity: 0.8 }}>{[t.supportContact, t.website?.replace(/^https:\/\//, '')].filter(Boolean).join(' · ')}</p>
      )}
    </div>
  );
}

// ───────────────────────── Labels ─────────────────────────

export function LabelsPanel({ orgId }: { orgId?: string }) {
  const jobs = useApi<LabelJob[]>(orgId ? `/ops/clients/${orgId}/labels` : '/labels');
  const dlBase = orgId ? '/api/ops/labels' : '/api/labels';
  return (
    <div className="space-y-3">
      {jobs.data?.map((j) => (
        <div key={j.id} className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="font-semibold">{mpName(j.marketplace)} · {d(j.batchDate)} · {j.orderCount} orders</p>
            <p className="text-xs text-ink-3">{j.dispatchBy ? `Dispatch by ${dt(j.dispatchBy)}` : 'Dispatch per marketplace SLA'}{j.noteCount ? ` · ${j.noteCount} thank-you inserts` : ''}{j.downloadedAt ? ` · downloaded ${dt(j.downloadedAt)}` : ''}</p>
            {j.skippedOrders?.text && <p className="mt-1 text-xs text-amber-800">Skipped: {j.skippedOrders.text}</p>}
            {j.note && <p className="mt-1 text-xs text-ink-2">{j.note}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Status s={j.status} label={j.status === 'READY' ? 'Ready to print' : undefined} />
            <a className="btn-primary py-1.5 text-xs" href={`${dlBase}/${j.id}/download`} onClick={() => setTimeout(jobs.reload, 1500)}>Download labels (PDF)</a>
            {j.noteCount > 0 && <Link className="btn-ghost py-1.5 text-xs" href={`/labels/${j.id}/notes${orgId ? '?ops=1' : ''}`} target="_blank">Print thank-you notes</Link>}
          </div>
        </div>
      ))}
      {jobs.data && !jobs.data.length && <Empty>No label batches yet. On Growth and Premium, SOLLUNA shares print-ready official labels here on your agreed daily schedule.</Empty>}
      {jobs.error && <Empty>{jobs.error}</Empty>}
      <p className="text-xs text-ink-3">Official marketplace labels are delivered exactly as generated — SOLLUNA never edits them. Thank-you notes are separate inserts.</p>
    </div>
  );
}

// ───────────────────────── Thank-you templates ─────────────────────────

export function ThankYouPanel({ orgId, staff = false }: { orgId?: string; staff?: boolean }) {
  const data = useApi<{ included: boolean; templates: Template[] }>(orgId ? `/ops/clients/${orgId}/thank-you` : '/thank-you');
  const [edit, setEdit] = useState<Template | 'new' | null>(null);
  const [flash, setFlash] = useState<FlashMsg>(null);
  async function act(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); setFlash({ kind: 'ok', text: ok }); data.reload(); } catch (e) { setFlash({ kind: 'err', text: errText(e) }); }
  }
  if (!data.data) return <Empty>{data.error ?? 'Loading…'}</Empty>;
  if (!data.data.included) return <Empty>Branded thank-you note inserts are part of the <strong>Premium</strong> plan.</Empty>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-3">Designs follow marketplace policy: no review requests for rewards, no star-rating asks, no steering away from marketplace returns.</p>
        <button className="btn-primary py-1.5 text-xs" onClick={() => setEdit('new')}>New design</button>
      </div>
      <Flash msg={flash} onClose={() => setFlash(null)} />
      <div className="grid gap-4 md:grid-cols-2">
        {data.data.templates.map((t) => (
          <div key={t.id} className="card space-y-3 p-5">
            <div className="flex items-center justify-between"><p className="font-semibold">{t.name} <span className="text-ink-3">v{t.version}</span></p><Status s={t.status} label={t.status === 'CLIENT_REVIEW' ? (staff ? 'With client' : 'Awaiting your approval') : undefined} /></div>
            <div className="flex justify-center rounded-xl bg-ivory-2 p-4"><NotePreview t={t} scale={0.55} /></div>
            <p className="text-xs text-ink-3">{t.widthMm} × {t.heightMm} mm{t.approvedAt ? ` · approved ${d(t.approvedAt)}` : ''}</p>
            {t.revisionNote && t.status === 'REVISION_REQUESTED' && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Changes requested: {t.revisionNote}</p>}
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost py-1.5 text-xs" onClick={() => setEdit(t)}>{t.status === 'APPROVED' ? 'Edit (creates new version)' : 'Edit'}</button>
              {staff && ['DRAFT', 'REVISION_REQUESTED'].includes(t.status) && <button className="btn-primary py-1.5 text-xs" onClick={() => act(() => api(`/ops/thank-you/${t.id}/submit`, { method: 'POST' }), 'Sent to the client for approval.')}>Send for client approval</button>}
              {!staff && t.status === 'CLIENT_REVIEW' && (<>
                <button className="btn-primary py-1.5 text-xs" onClick={() => act(() => api(`/thank-you/${t.id}/decision`, { method: 'POST', body: { decision: 'APPROVE' } }), 'Design approved. It will be printed with your next label batches.')}>Approve design</button>
                <RequestChanges onSubmit={(note) => act(() => api(`/thank-you/${t.id}/decision`, { method: 'POST', body: { decision: 'REQUEST_CHANGES', note } }), 'Change request sent to SOLLUNA.')} />
              </>)}
            </div>
          </div>
        ))}
        {!data.data.templates.length && <Empty>No designs yet. Create one, or ask your manager to design it for you.</Empty>}
      </div>
      {edit && <TemplateEditor t={edit === 'new' ? null : edit} orgId={orgId} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); setFlash(m); data.reload(); }} />}
    </div>
  );
}

function RequestChanges({ onSubmit }: { onSubmit: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn-ghost py-1.5 text-xs" onClick={() => setOpen(true)}>Request changes</button>;
  return (
    <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); const n = String(new FormData(e.currentTarget).get('note') ?? '').trim(); if (n) onSubmit(n); }}>
      <input name="note" className="input py-1.5 text-xs" placeholder="What should change?" aria-label="Requested changes" required autoFocus />
      <button className="btn-ghost py-1.5 text-xs">Send</button>
    </form>
  );
}

function TemplateEditor({ t, orgId, onClose, onSaved }: { t: Template | null; orgId?: string; onClose: () => void; onSaved: (m: FlashMsg) => void }) {
  const images = useApi<{ id: string; title: string; mimeType: string }[]>(orgId ? `/documents?organizationId=${orgId}` : '/documents');
  const [v, setV] = useState({
    name: t?.name ?? 'Thank you note', brandName: t?.brandName ?? '', message: t?.message ?? 'Thank you for choosing us. We hope you love your purchase.',
    supportContact: t?.supportContact ?? '', website: t?.website ?? '', colors: t?.colors ?? { primary: '#C9962B', background: '#FFFFFF', text: '#12131C' },
    widthMm: t?.widthMm ?? 100, heightMm: t?.heightMm ?? 150, logoDocumentId: t?.logoKey ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logos = (images.data ?? []).filter((x) => ['image/png', 'image/jpeg', 'image/webp'].includes(x.mimeType));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const body = { ...v, supportContact: v.supportContact || undefined, website: v.website || '', logoDocumentId: v.logoDocumentId || undefined };
    const path = orgId ? `/ops/clients/${orgId}/thank-you${t ? `/${t.id}` : ''}` : `/thank-you${t ? `/${t.id}` : ''}`;
    try { await api(path, { method: t ? 'PATCH' : 'POST', body }); onSaved({ kind: 'ok', text: t?.status === 'APPROVED' ? `Saved as version ${t.version + 1}. Your approved version keeps printing until the new one is approved.` : 'Design saved as a draft.' }); }
    catch (err) { setError(errText(err)); setBusy(false); }
  }
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));
  return (
    <Modal title={t ? `Edit ${t.name}` : 'New thank-you design'} onClose={onClose}>
      <form onSubmit={save} className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="ty-name">Design name</label><input id="ty-name" className="input" value={v.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div><label className="label" htmlFor="ty-brand">Brand name on note</label><input id="ty-brand" className="input" value={v.brandName} onChange={(e) => set('brandName', e.target.value)} required /></div>
          </div>
          <div><label className="label" htmlFor="ty-msg">Message</label><textarea id="ty-msg" className="input min-h-24" value={v.message} onChange={(e) => set('message', e.target.value)} maxLength={600} required /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="ty-sup">Support contact (optional)</label><input id="ty-sup" className="input" value={v.supportContact} onChange={(e) => set('supportContact', e.target.value)} placeholder="care@brand.in" /></div>
            <div><label className="label" htmlFor="ty-web">Website (optional, https)</label><input id="ty-web" className="input" value={v.website} onChange={(e) => set('website', e.target.value)} placeholder="https://brand.in" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {(['primary', 'background', 'text'] as const).map((c) => (
              <div key={c}><label className="label" htmlFor={`ty-${c}`}>{c}</label><input id={`ty-${c}`} type="color" className="h-10 w-full cursor-pointer rounded-lg border border-ink/15" value={v.colors[c]} onChange={(e) => set('colors', { ...v.colors, [c]: e.target.value.toUpperCase() })} /></div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label" htmlFor="ty-w">Width mm</label><input id="ty-w" type="number" min={50} max={210} className="input" value={v.widthMm} onChange={(e) => set('widthMm', Number(e.target.value))} /></div>
            <div><label className="label" htmlFor="ty-h">Height mm</label><input id="ty-h" type="number" min={50} max={297} className="input" value={v.heightMm} onChange={(e) => set('heightMm', Number(e.target.value))} /></div>
            <div><label className="label" htmlFor="ty-logo">Logo</label><select id="ty-logo" className="input" value={v.logoDocumentId} onChange={(e) => set('logoDocumentId', e.target.value)}><option value="">None</option>{logos.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select></div>
          </div>
          <p className="text-xs text-ink-3">Logo: upload a PNG/JPEG in Documents first. Common sizes: 100×150 mm (4×6 in) or 95×95 mm.</p>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button></div>
        </div>
        <div className="flex justify-center rounded-xl bg-ivory-2 p-4"><NotePreview t={{ ...v, logoUrl: v.logoDocumentId ? `/api/documents/${v.logoDocumentId}/download` : null, website: v.website || null, supportContact: v.supportContact || null }} scale={0.6} /></div>
      </form>
    </Modal>
  );
}

// ───────────────────────── Inventory ─────────────────────────

export function InventoryPanel({ orgId }: { orgId?: string }) {
  const inv = useApi<Inventory>(orgId ? `/ops/clients/${orgId}/inventory` : '/inventory');
  async function ack(id: string) { await api(`/inventory/${id}/acknowledge`, { method: 'POST' }); inv.reload(); }
  if (!inv.data) return <Empty>{inv.error ?? 'Loading…'}</Empty>;
  if (!inv.data.included) return <Empty>Low stock alerts are part of the <strong>Growth</strong> and <strong>Premium</strong> plans.</Empty>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 text-xs">{Object.entries(inv.data.thresholds).map(([k, v]) => <span key={k} className="flex items-center gap-1"><Status s={k} /> {v}</span>)}</div>
      {(['AMAZON', 'FLIPKART'] as const).map((mp) => {
        const s = inv.data!.marketplaces[mp];
        return (
          <section key={mp} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{mpName(mp)}</h2>
              {s && <p className={`text-xs ${s.stale ? 'font-semibold text-red-700' : 'text-ink-3'}`}>Data as of {dt(s.dataAsOf)}{s.stale ? ' — stale, awaiting fresh marketplace data' : ''}</p>}
            </div>
            {!s ? <Empty>No inventory snapshot yet.</Empty> : (
              <div className="card overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wider text-ink-3"><th className="p-3">Product</th><th>Sellable</th><th>Inbound</th><th>Sales/day</th><th>Days of cover</th><th>Status</th>{!orgId && <th />}</tr></thead>
                  <tbody>
                    {s.rows.map((r) => (
                      <tr key={r.id} className="border-t border-ink/5">
                        <td className="p-3"><p className="font-medium">{r.name}</p><p className="text-xs text-ink-3">{r.sku}</p></td>
                        <td>{r.sellable}</td><td>{r.inbound ?? '—'}</td><td>{r.avgDailySales ?? <span className="text-ink-3">n/a</span>}</td>
                        <td>{r.daysOfCover ?? <span className="text-ink-3">n/a</span>}</td>
                        <td>{r.severity ? <Status s={r.severity} /> : <span className="text-xs text-ink-3">Velocity unavailable</span>}</td>
                        {!orgId && <td className="p-3 text-right">{(r.severity === 'CRITICAL' || r.severity === 'HIGH') && (r.acknowledgedAt ? <span className="text-xs text-ink-3">Acknowledged</span> : <button className="btn-ghost py-1 text-xs" onClick={() => ack(r.id)}>Acknowledge</button>)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      <p className="text-xs text-ink-3">Alert thresholds are SOLLUNA defaults and can be tuned to your lead times. No purchase or transfer happens without your approval.</p>
    </div>
  );
}

export function ClientFulfilment() {
  const [tab, setTab] = useState<'labels' | 'notes'>('labels');
  return (
    <div className="space-y-5">
      <div><h1 className="font-display text-3xl">Shipping labels</h1><p className="text-sm text-ink-3">Daily label batches and branded thank-you inserts.</p></div>
      <div className="flex gap-1">
        <button className={tab === 'labels' ? 'btn-primary py-1.5 text-xs' : 'btn-ghost py-1.5 text-xs'} onClick={() => setTab('labels')}>Label batches</button>
        <button className={tab === 'notes' ? 'btn-primary py-1.5 text-xs' : 'btn-ghost py-1.5 text-xs'} onClick={() => setTab('notes')}>Thank-you notes</button>
      </div>
      {tab === 'labels' ? <LabelsPanel /> : <ThankYouPanel />}
    </div>
  );
}

export function ClientInventory() {
  return (
    <div className="space-y-5">
      <div><h1 className="font-display text-3xl">Inventory &amp; low stock</h1><p className="text-sm text-ink-3">Days of cover per SKU from your latest marketplace inventory data.</p></div>
      <InventoryPanel />
    </div>
  );
}

