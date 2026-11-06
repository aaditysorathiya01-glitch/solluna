'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Empty, Flash, Status, SubTabs, d, errText, formBody, human, mpName, useApi, type FlashMsg } from './ui';
import type { Listing, MarketplaceRow, Mapping } from './ClientCatalog';
import { InventoryPanel, LabelsPanel, ThankYouPanel } from './Fulfilment';

interface Onboarding { complete: boolean; steps: { key: string; label: string; done: boolean }[] }

const LISTING_STATUSES = ['RESEARCH_NOT_STARTED', 'EXISTING_ID_CHECK', 'EXISTING_ID_FOUND', 'NEW_CATALOG_CANDIDATE', 'ELIGIBILITY_CHECK', 'BRAND_APPROVAL_REQUIRED', 'APPROVAL_REQUIRED', 'DOCUMENTS_PENDING', 'CONTENT_IN_PROGRESS', 'CONTENT_REVIEW', 'CLIENT_APPROVAL_PENDING', 'APPROVED_FOR_SUBMISSION', 'SUBMITTED', 'PROCESSING', 'PROCESSING_ERROR', 'CATALOG_ID_CREATED', 'LISTING_INCOMPLETE', 'SUPPRESSED', 'ACTIVE', 'INACTIVE', 'REJECTED', 'BLOCKED', 'CANCELLED'];
const MAPPING_STATUSES = ['NOT_ASSESSED', 'EXACT_VERIFIED', 'HIGH_CONFIDENCE', 'REVIEW_REQUIRED', 'NO_MATCH_FOUND', 'CONFLICT', 'NOT_ELIGIBLE_OR_BLOCKED'];
const TABS = [['setup', 'Onboarding & accounts'], ['listings', 'Listings'], ['mapping', 'Mapping'], ['labels', 'Labels'], ['notes', 'Thank-you notes'], ['stock', 'Inventory']] as const;

/** Clients this staff member can see (assignment or role-scoped work), via the chat inbox endpoint. */
export function OpsClients() {
  const inbox = useApi<{ organizationId: string; name: string; managers: { name: string }[] }[]>('/ops/chats');
  const [orgId, setOrgId] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('setup');
  const [flash, setFlash] = useState<FlashMsg>(null);
  const [rev, setRev] = useState(0);
  const bump = (m: FlashMsg) => { setFlash(m); if (m?.kind === 'ok') setRev((r) => r + 1); };
  const clients = (inbox.data ?? []).map((c) => ({ id: c.organizationId, name: c.name, managers: c.managers.map((m) => m.name).join(', ') })).sort((a, b) => a.name.localeCompare(b.name));
  const current = clients.find((c) => c.id === orgId);
  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside>
        <h1 className="mb-3 font-display text-2xl">Clients</h1>
        <ul className="space-y-1">
          {clients.map((c) => (
            <li key={c.id}><button onClick={() => { setOrgId(c.id); setFlash(null); }} className={`w-full rounded-xl px-3 py-2 text-left text-sm ${orgId === c.id ? 'bg-ink text-ivory' : 'hover:bg-white'}`}>{c.name}<span className={`block text-xs ${orgId === c.id ? 'text-ivory/60' : 'text-ink-3'}`}>{c.managers ? `Manager: ${c.managers}` : 'No manager assigned'}</span></button></li>
          ))}
          {inbox.data && !clients.length && <li className="text-sm text-ink-3">No clients assigned to you yet.</li>}
        </ul>
      </aside>
      <section className="min-w-0 space-y-4">
        {!current ? <Empty>Select a client.</Empty> : (<>
          <h2 className="font-display text-2xl">{current.name}</h2>
          <SubTabs tabs={TABS} value={tab} onChange={setTab} />
          <Flash msg={flash} onClose={() => setFlash(null)} />
          {tab === 'setup' && <Setup key={current.id} orgId={current.id} onFlash={setFlash} />}
          {tab === 'listings' && <OpsListings key={current.id} orgId={current.id} onFlash={setFlash} />}
          {tab === 'mapping' && <OpsMappings key={current.id} orgId={current.id} onFlash={setFlash} />}
          {tab === 'labels' && <div key={current.id} className="space-y-4"><LabelUpload orgId={current.id} onFlash={bump} /><LabelsPanel key={rev} orgId={current.id} /></div>}
          {tab === 'notes' && <ThankYouPanel key={current.id} orgId={current.id} staff />}
          {tab === 'stock' && <div key={current.id} className="space-y-4"><StockEntry orgId={current.id} onFlash={bump} /><InventoryPanel key={rev} orgId={current.id} /></div>}
        </>)}
      </section>
    </main>
  );
}

function Setup({ orgId, onFlash }: { orgId: string; onFlash: (m: FlashMsg) => void }) {
  const ob = useApi<Onboarding>(`/ops/clients/${orgId}/onboarding`);
  const mps = useApi<MarketplaceRow[]>(`/ops/clients/${orgId}/marketplaces`);
  async function verify(mp: string, form: HTMLFormElement) {
    const b = formBody(form);
    try { await api(`/ops/clients/${orgId}/marketplaces/${mp}`, { method: 'PATCH', body: b }); onFlash({ kind: 'ok', text: `${mpName(mp)} status updated; client notified.` }); mps.reload(); ob.reload(); }
    catch (e) { onFlash({ kind: 'err', text: errText(e) }); }
  }
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h3 className="font-semibold">Onboarding {ob.data?.complete && <Status s="COMPLETED" label="Complete" />}</h3>
        <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">{ob.data?.steps.map((s) => <li key={s.key} className={s.done ? 'text-ink-3' : ''}>{s.done ? '✓' : '○'} {s.label}</li>)}</ul>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {mps.data?.map((m) => (
          <div key={m.marketplace} className="card space-y-3 p-5">
            <div className="flex items-center justify-between"><h3 className="font-semibold">{mpName(m.marketplace)}</h3><Status s={m.status} /></div>
            {m.status === 'NOT_PROVIDED' ? <p className="text-sm text-ink-3">Client hasn&apos;t added details.</p> : m.hasAccount === false ? <p className="text-sm">Client has no account — offer Seller Account Registration.</p> : (
              <>
                <p className="text-sm">{m.storeName} · {m.sellerId ?? 'no seller ID'}{m.contactEmail ? ` · ${m.contactEmail}` : ''}</p>
                {m.verifiedNote && <p className="text-xs text-emerald-800">{m.verifiedNote}</p>}
                <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); verify(m.marketplace, e.currentTarget); }}>
                  <select name="status" className="input" defaultValue={m.status} aria-label="Connection status">{['PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED'].map((s) => <option key={s} value={s}>{human(s)}</option>)}</select>
                  <input name="note" className="input" placeholder="Evidence: e.g. user permission accepted in Seller Central on 6 Nov" aria-label="Verification note" />
                  <button className="btn-primary py-1.5 text-xs">Update status</button>
                </form>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OpsListings({ orgId, onFlash }: { orgId: string; onFlash: (m: FlashMsg) => void }) {
  const rows = useApi<Listing[]>(`/ops/clients/${orgId}/listings`);
  const [open, setOpen] = useState<string | null>(null);
  async function update(id: string, form: HTMLFormElement) {
    try { await api(`/ops/listings/${id}`, { method: 'PATCH', body: formBody(form) }); onFlash({ kind: 'ok', text: 'Listing status updated; client notified.' }); setOpen(null); rows.reload(); }
    catch (e) { onFlash({ kind: 'err', text: errText(e) }); }
  }
  return (
    <div className="space-y-2">
      {rows.data?.map((l) => (
        <div key={l.id} className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="font-medium">{l.product.name} · {mpName(l.marketplace)}</p><p className="text-xs text-ink-3">{l.product.sku ?? 'no SKU'} · updated {d(l.updatedAt)}{l.catalogId ? ` · ${l.catalogId}` : ''}</p></div>
            <div className="flex items-center gap-2"><Status s={l.status} /><button className="btn-ghost py-1 text-xs" onClick={() => setOpen(open === l.id ? null : l.id)}>Update</button></div>
          </div>
          {open === l.id && (
            <form className="mt-3 grid gap-2 border-t border-ink/10 pt-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); update(l.id, e.currentTarget); }}>
              <select name="status" className="input" defaultValue={l.status} aria-label="Listing status">{LISTING_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}</select>
              <input name="catalogId" className="input" placeholder={l.marketplace === 'AMAZON' ? 'ASIN (from Seller Central)' : 'FSN (from Seller Hub)'} defaultValue={l.catalogId ?? ''} aria-label="Catalog ID" />
              <input name="liveUrl" className="input sm:col-span-2" placeholder="Live product URL (required for Active)" defaultValue={l.liveUrl ?? ''} aria-label="Live URL" />
              <input name="note" className="input sm:col-span-2" placeholder="Note to client (required for rejected / blocked / errors)" aria-label="Note" />
              <p className="text-xs text-ink-3 sm:col-span-2">Live, catalog-created, suppressed and inactive need marketplace confirmation (ASIN/FSN; URL for live). Skill: {l.marketplace === 'AMAZON' ? 'amazon-new-listings §15' : 'flipkart-new-listings §16'}.</p>
              <button className="btn-primary py-1.5 text-xs sm:col-span-2 sm:justify-self-start">Save</button>
            </form>
          )}
        </div>
      ))}
      {rows.data && !rows.data.length && <Empty>No listing requests for this client.</Empty>}
    </div>
  );
}

function OpsMappings({ orgId, onFlash }: { orgId: string; onFlash: (m: FlashMsg) => void }) {
  const rows = useApi<Mapping[]>(`/ops/clients/${orgId}/mappings`);
  async function update(id: string, form: HTMLFormElement) {
    try { await api(`/ops/mappings/${id}`, { method: 'PATCH', body: formBody(form) }); onFlash({ kind: 'ok', text: 'Mapping result saved.' }); rows.reload(); }
    catch (e) { onFlash({ kind: 'err', text: errText(e) }); }
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-3">Confidence per existing-catalog-mapping §7. HIGH_CONFIDENCE needs a second reviewer before upload.</p>
      {rows.data?.map((m) => (
        <form key={m.id} className="card grid items-center gap-2 p-4 md:grid-cols-[minmax(0,2fr)_160px_140px_minmax(0,2fr)_auto]" onSubmit={(e) => { e.preventDefault(); update(m.id, e.currentTarget); }}>
          <div><p className="text-sm font-medium">{m.identifier}</p><p className="text-xs text-ink-3">{mpName(m.marketplace)} · {m.sellerSku ?? 'no SKU'}</p></div>
          <select name="status" className="input py-1.5 text-xs" defaultValue={m.status} aria-label="Result">{MAPPING_STATUSES.map((s) => <option key={s} value={s}>{human(s)}</option>)}</select>
          <input name="candidateId" className="input py-1.5 text-xs" defaultValue={m.candidateId ?? ''} placeholder="ASIN / FSN" aria-label="Matched ID" />
          <input name="note" className="input py-1.5 text-xs" defaultValue={m.note ?? ''} placeholder="Explanation" aria-label="Note" />
          <button className="btn-ghost py-1.5 text-xs">Save</button>
        </form>
      ))}
      {rows.data && !rows.data.length && <Empty>No mapping requests.</Empty>}
    </div>
  );
}

function LabelUpload({ orgId, onFlash }: { orgId: string; onFlash: (m: FlashMsg) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true);
    const form = e.currentTarget; const fd = new FormData(form);
    const dispatch = fd.get('dispatchBy');
    if (dispatch) fd.set('dispatchBy', new Date(String(dispatch)).toISOString()); else fd.delete('dispatchBy');
    for (const k of ['skippedOrders', 'note']) if (!String(fd.get(k) ?? '').trim()) fd.delete(k);
    try {
      const r = await fetch(`/api/ops/clients/${orgId}/labels`, { method: 'POST', body: fd, credentials: 'same-origin' });
      const j = await r.json();
      if (!r.ok) throw new Error(Array.isArray(j.message) ? j.message.join(', ') : j.message ?? `Upload failed (${r.status})`);
      onFlash({ kind: 'ok', text: `Batch ready: ${j.orderCount} orders${j.noteCount ? ` + ${j.noteCount} thank-you inserts` : ''}. Client notified.` });
      form.reset();
    } catch (err) { onFlash({ kind: 'err', text: (err as Error).message }); }
    setBusy(false);
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form onSubmit={submit} className="card grid gap-3 p-5 sm:grid-cols-3">
      <h3 className="font-semibold sm:col-span-3">Publish a label batch</h3>
      <div><label className="label" htmlFor="lb-mp">Marketplace</label><select id="lb-mp" name="marketplace" className="input"><option value="AMAZON">Amazon</option><option value="FLIPKART">Flipkart</option></select></div>
      <div><label className="label" htmlFor="lb-date">Batch date</label><input id="lb-date" name="batchDate" type="date" className="input" defaultValue={today} required /></div>
      <div><label className="label" htmlFor="lb-count">Orders in batch</label><input id="lb-count" name="orderCount" type="number" min={1} className="input" required /></div>
      <div><label className="label" htmlFor="lb-dispatch">Dispatch by</label><input id="lb-dispatch" name="dispatchBy" type="datetime-local" className="input" /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="lb-skip">Skipped orders (duplicates / cancelled / invalid)</label><input id="lb-skip" name="skippedOrders" className="input" placeholder="402-1234567 cancelled by buyer" /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="lb-file">Official label PDF (unaltered)</label><input id="lb-file" name="file" type="file" accept="application/pdf" className="input" required /></div>
      <div><label className="label" htmlFor="lb-note">Note to client</label><input id="lb-note" name="note" className="input" /></div>
      <p className="text-xs text-ink-3 sm:col-span-3">Growth/Premium only (enforced by the API). Premium batches automatically include the approved thank-you design as separate inserts. Skill: daily-label-processing-delivery.</p>
      <button className="btn-primary sm:col-span-3 sm:justify-self-start" disabled={busy}>{busy ? 'Uploading…' : 'Publish batch'}</button>
    </form>
  );
}

function StockEntry({ orgId, onFlash }: { orgId: string; onFlash: (m: FlashMsg) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true);
    const form = e.currentTarget; const f = new FormData(form);
    const lines = String(f.get('csv') ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !/^sku\s*,/i.test(l));
    try {
      const rows = lines.map((l, i) => {
        const [sku, name, sellable, avg, inbound] = l.split(',').map((x) => x.trim());
        if (!sku || sellable === undefined || isNaN(Number(sellable))) throw new Error(`Line ${i + 1}: expected sku, name, sellable, avgDailySales, inbound`);
        return { sku, ...(name ? { name } : {}), sellable: Number(sellable), avgDailySales: avg === '' || avg === undefined ? null : Number(avg), ...(inbound ? { inbound: Number(inbound) } : {}) };
      });
      const r = await api<{ rows: number; urgent: number }>(`/ops/clients/${orgId}/inventory`, { method: 'POST', body: { marketplace: f.get('marketplace'), dataAsOf: new Date(String(f.get('dataAsOf'))).toISOString(), rows } });
      onFlash({ kind: 'ok', text: `${r.rows} SKUs recorded. ${r.urgent ? `${r.urgent} urgent alert(s) sent to the client.` : 'No urgent alerts.'}` });
      form.reset();
    } catch (err) { onFlash({ kind: 'err', text: errText(err) }); }
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="card grid gap-3 p-5 sm:grid-cols-2">
      <h3 className="font-semibold sm:col-span-2">Record inventory snapshot</h3>
      <div><label className="label" htmlFor="st-mp">Marketplace</label><select id="st-mp" name="marketplace" className="input"><option value="AMAZON">Amazon</option><option value="FLIPKART">Flipkart</option></select></div>
      <div><label className="label" htmlFor="st-asof">Marketplace data as of</label><input id="st-asof" name="dataAsOf" type="datetime-local" className="input" required /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="st-csv">CSV: sku, name, sellable, avgDailySales, inbound</label><textarea id="st-csv" name="csv" className="input min-h-28 font-mono text-xs" required placeholder={'BD-4, Brass Diya Set, 6, 2.5, 0\nLAMP-1, Brass Lamp, 40, 1.2, 100'} /></div>
      <p className="text-xs text-ink-3 sm:col-span-2">Leave avgDailySales empty if unknown — severity is not guessed. Severity per low-stock-alerts §7; Critical/High alert the client.</p>
      <button className="btn-primary sm:justify-self-start" disabled={busy}>{busy ? 'Saving…' : 'Record snapshot'}</button>
    </form>
  );
}

