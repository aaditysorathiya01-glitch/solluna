'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Empty, Flash, Modal, Status, d, errText, formBody, human, inrExact, mpName, SubTabs, useApi, type FlashMsg } from './ui';

export interface MarketplaceRow { marketplace: string; hasAccount: boolean | null; sellerId: string | null; storeName: string | null; contactEmail: string | null; status: string; verifiedNote: string | null; lastError: string | null; updatedAt: string | null }
export interface Listing { id: string; productId: string; marketplace: string; status: string; statusLabel: string; catalogId: string | null; liveUrl: string | null; rejectionNote: string | null; history: { status: string; note: string | null; at: string; by: string }[]; updatedAt: string; product: { name: string; sku: string | null; brand: string | null } }
export interface Product { id: string; name: string; brand: string | null; category: string | null; sku: string | null; hsn: string | null; gstRate: string | null; mrpPaise: number | null; sellingPaise: number | null; specs: { text?: string } | null; variations: { text?: string } | null; asin: string | null; fsn: string | null; listingRequests: { id: string; marketplace: string; status: string }[] }
export interface Mapping { id: string; marketplace: string; identifier: string; sellerSku: string | null; status: string; candidateId: string | null; note: string | null; updatedAt: string; productInfo: { name?: string } | null }

const TABS = [['accounts', 'Marketplace accounts'], ['products', 'Products & listings'], ['mapping', 'Catalog mapping']] as const;

export function ClientCatalog() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('accounts');
  const [flash, setFlash] = useState<FlashMsg>(null);
  return (
    <div className="space-y-5">
      <div><h1 className="font-display text-3xl">Catalog</h1><p className="text-sm text-ink-3">Your seller accounts, products and their Amazon / Flipkart status — tracked separately per marketplace.</p></div>
      <SubTabs tabs={TABS} value={tab} onChange={setTab} />
      <Flash msg={flash} onClose={() => setFlash(null)} />
      {tab === 'accounts' && <MarketplaceAccounts onFlash={setFlash} />}
      {tab === 'products' && <ProductsListings onFlash={setFlash} />}
      {tab === 'mapping' && <MappingPanel onFlash={setFlash} />}
    </div>
  );
}

export function MarketplaceAccounts({ onFlash }: { onFlash: (m: FlashMsg) => void }) {
  const rows = useApi<MarketplaceRow[]>('/marketplaces');
  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-moon/5 px-4 py-3 text-sm text-ink-2"><strong>We never need your password or OTP.</strong> Add your store details here; your manager will send a user-permission invite / authorised access request, and the status turns <em>Connected</em> only after SOLLUNA confirms access in Seller Central / Seller Hub.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {rows.data?.map((m) => <MarketplaceCard key={m.marketplace} m={m} onSaved={(msg) => { onFlash(msg); rows.reload(); }} />)}
      </div>
      {rows.error && <Empty>{rows.error}</Empty>}
    </div>
  );
}

function MarketplaceCard({ m, onSaved }: { m: MarketplaceRow; onSaved: (msg: FlashMsg) => void }) {
  const [editing, setEditing] = useState(m.status === 'NOT_PROVIDED');
  const [has, setHas] = useState(m.hasAccount ?? true);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null);
    const b = formBody(e.currentTarget);
    try {
      await api(`/marketplaces/${m.marketplace}`, { method: 'PUT', body: has ? { hasAccount: true, storeName: b.storeName, sellerId: b.sellerId, contactEmail: b.contactEmail ?? '' } : { hasAccount: false } });
      setEditing(false); onSaved({ kind: 'ok', text: `${mpName(m.marketplace)} details saved. Your manager will confirm access.` });
    } catch (err) { setError(errText(err)); }
  }
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between"><h2 className="font-display text-xl">{mpName(m.marketplace)}</h2><Status s={m.status} label={m.status === 'NOT_PROVIDED' ? 'Not added' : m.status === 'PENDING' ? 'Awaiting verification' : undefined} /></div>
      {!editing ? (
        <div className="mt-3 space-y-1 text-sm">
          {m.hasAccount === false ? <p>No seller account yet — ask for <strong>Seller Account Registration</strong> in Services.</p> : (<>
            <p><span className="text-ink-3">Store:</span> {m.storeName ?? '—'}</p>
            <p><span className="text-ink-3">Seller ID:</span> {m.sellerId ?? '—'}</p>
            {m.contactEmail && <p><span className="text-ink-3">Seller login email:</span> {m.contactEmail}</p>}
          </>)}
          {m.status === 'CONNECTED' && m.verifiedNote && <p className="text-xs text-emerald-800">Verified: {m.verifiedNote}</p>}
          {m.lastError && m.status === 'ERROR' && <p className="text-xs text-red-800">{m.lastError}</p>}
          <button className="btn-ghost mt-3 py-1.5 text-xs" onClick={() => setEditing(true)}>Edit</button>
        </div>
      ) : (
        <form className="mt-4 space-y-3" onSubmit={save}>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={has} onChange={() => setHas(true)} /> I have a seller account</label>
            <label className="flex items-center gap-2"><input type="radio" checked={!has} onChange={() => setHas(false)} /> Not yet</label>
          </div>
          {has && (<>
            <div><label className="label" htmlFor={`${m.marketplace}-store`}>Store / display name</label><input id={`${m.marketplace}-store`} name="storeName" className="input" defaultValue={m.storeName ?? ''} /></div>
            <div><label className="label" htmlFor={`${m.marketplace}-sid`}>Seller ID / Merchant token</label><input id={`${m.marketplace}-sid`} name="sellerId" className="input" defaultValue={m.sellerId ?? ''} /></div>
            <div><label className="label" htmlFor={`${m.marketplace}-email`}>Seller login email (optional)</label><input id={`${m.marketplace}-email`} name="contactEmail" type="email" className="input" defaultValue={m.contactEmail ?? ''} /></div>
          </>)}
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <div className="flex gap-2"><button className="btn-primary">Save</button>{m.status !== 'NOT_PROVIDED' && <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>}</div>
        </form>
      )}
    </div>
  );
}

function ProductsListings({ onFlash }: { onFlash: (m: FlashMsg) => void }) {
  const products = useApi<Product[]>('/products');
  const listings = useApi<Listing[]>('/listings');
  const [edit, setEdit] = useState<Product | 'new' | null>(null);
  const [listFor, setListFor] = useState<Product | null>(null);
  const [history, setHistory] = useState<Listing | null>(null);
  const reload = () => { products.reload(); listings.reload(); };
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Products</h2><button className="btn-primary py-1.5 text-xs" onClick={() => setEdit('new')}>Add product</button></div>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wider text-ink-3"><th className="p-3">Product</th><th>SKU</th><th>MRP / Selling</th><th>Amazon</th><th>Flipkart</th><th /></tr></thead>
            <tbody>
              {products.data?.map((p) => {
                const st = (mp: string) => listings.data?.find((l) => l.productId === p.id && l.marketplace === mp);
                return (
                  <tr key={p.id} className="border-t border-ink/5">
                    <td className="p-3"><p className="font-medium">{p.name}</p><p className="text-xs text-ink-3">{[p.brand, p.category].filter(Boolean).join(' · ')}</p></td>
                    <td>{p.sku ?? '—'}</td>
                    <td>{p.mrpPaise != null ? inrExact(p.mrpPaise) : '—'} / {p.sellingPaise != null ? inrExact(p.sellingPaise) : '—'}</td>
                    {['AMAZON', 'FLIPKART'].map((mp) => { const l = st(mp); return <td key={mp}>{l ? <button onClick={() => setHistory(l)}><Status s={l.status} label={l.statusLabel} /></button> : (mp === 'AMAZON' ? p.asin : p.fsn) ? <span className="text-xs">{mp === 'AMAZON' ? p.asin : p.fsn}</span> : <span className="text-ink-3">—</span>}</td>; })}
                    <td className="space-x-2 whitespace-nowrap p-3 text-right"><button className="text-xs underline" onClick={() => setEdit(p)}>Edit</button><button className="btn-ghost py-1 text-xs" onClick={() => setListFor(p)}>Request listing</button></td>
                  </tr>
                );
              })}
              {products.data && !products.data.length && <tr><td className="p-4 text-ink-3" colSpan={6}>Add your first product to request a listing.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Listing requests</h2>
        {listings.data?.map((l) => (
          <button key={l.id} onClick={() => setHistory(l)} className="card flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:border-sun">
            <div><p className="font-medium">{l.product.name} <span className="text-ink-3">· {mpName(l.marketplace)}</span></p><p className="text-xs text-ink-3">Updated {d(l.updatedAt)}{l.catalogId ? ` · ${l.marketplace === 'AMAZON' ? 'ASIN' : 'FSN'} ${l.catalogId}` : ''}</p></div>
            <div className="flex items-center gap-3">{l.liveUrl && <a className="text-xs underline" href={l.liveUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>View live</a>}<Status s={l.status} label={l.statusLabel} /></div>
          </button>
        ))}
        {listings.data && !listings.data.length && <Empty>No listing requests yet.</Empty>}
      </section>
      {edit && <ProductForm product={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(msg) => { setEdit(null); onFlash(msg); reload(); }} />}
      {listFor && <RequestListing product={listFor} onClose={() => setListFor(null)} onDone={(msg) => { setListFor(null); onFlash(msg); reload(); }} />}
      {history && (
        <Modal title={`${history.product.name} · ${mpName(history.marketplace)}`} onClose={() => setHistory(null)}>
          {history.rejectionNote && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-900">{history.rejectionNote}</p>}
          <ol className="space-y-2 text-sm">
            {[...history.history].reverse().map((h, i) => (
              <li key={i} className="flex flex-wrap items-start justify-between gap-2 border-b border-ink/5 pb-2"><div><Status s={h.status} />{h.note && <p className="mt-1 text-ink-2">{h.note}</p>}</div><span className="text-xs text-ink-3">{new Date(h.at).toLocaleString('en-IN')} · {h.by}</span></li>
            ))}
          </ol>
        </Modal>
      )}
    </div>
  );
}

function ProductForm({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: (m: FlashMsg) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null);
    const b = formBody(e.currentTarget) as Record<string, string>;
    const body = { ...b, mrp: b.mrp ? Number(b.mrp) : undefined, sellingPrice: b.sellingPrice ? Number(b.sellingPrice) : undefined, gstRate: b.gstRate ? Number(b.gstRate) : undefined };
    try {
      const r = await api<{ notice?: string }>(product ? `/products/${product.id}` : '/products', { method: product ? 'PATCH' : 'POST', body });
      onSaved({ kind: 'ok', text: r.notice ?? 'Product saved.' });
    } catch (err) { setError(errText(err)); setBusy(false); }
  }
  const rs = (p: number | null) => (p == null ? '' : String(p / 100));
  return (
    <Modal title={product ? 'Edit product' : 'Add product'} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label" htmlFor="pr-name">Product name</label><input id="pr-name" name="name" className="input" defaultValue={product?.name} required /></div>
        <div><label className="label" htmlFor="pr-brand">Brand</label><input id="pr-brand" name="brand" className="input" defaultValue={product?.brand ?? ''} /></div>
        <div><label className="label" htmlFor="pr-cat">Category</label><input id="pr-cat" name="category" className="input" defaultValue={product?.category ?? ''} /></div>
        <div><label className="label" htmlFor="pr-sku">SKU</label><input id="pr-sku" name="sku" className="input" defaultValue={product?.sku ?? ''} /></div>
        <div><label className="label" htmlFor="pr-hsn">HSN code</label><input id="pr-hsn" name="hsn" className="input" inputMode="numeric" defaultValue={product?.hsn ?? ''} /></div>
        <div><label className="label" htmlFor="pr-mrp">MRP (₹)</label><input id="pr-mrp" name="mrp" type="number" step="0.01" min="0" className="input" defaultValue={rs(product?.mrpPaise ?? null)} /></div>
        <div><label className="label" htmlFor="pr-sp">Selling price (₹)</label><input id="pr-sp" name="sellingPrice" type="number" step="0.01" min="0" className="input" defaultValue={rs(product?.sellingPaise ?? null)} /></div>
        <div><label className="label" htmlFor="pr-gst">GST rate</label><select id="pr-gst" name="gstRate" className="input" defaultValue={product?.gstRate ? String(Number(product.gstRate)) : ''}><option value="">Select</option>{[0, 0.25, 3, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="pr-specs">Key specifications</label><textarea id="pr-specs" name="specs" className="input min-h-20" defaultValue={product?.specs?.text ?? ''} placeholder="Material, dimensions, weight, pack contents…" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="pr-var">Variations (size / colour)</label><input id="pr-var" name="variations" className="input" defaultValue={product?.variations?.text ?? ''} /></div>
        <p className="text-xs text-ink-3 sm:col-span-2">Upload product images in Documents (type: Listing assets).</p>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button></div>
      </form>
    </Modal>
  );
}

function RequestListing({ product, onClose, onDone }: { product: Product; onClose: () => void; onDone: (m: FlashMsg) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    const marketplaces = f.getAll('mp');
    if (!marketplaces.length) { setError('Choose at least one marketplace'); setBusy(false); return; }
    try {
      const r = await api<{ results: { marketplace: string; created: boolean; reason?: string }[] }>('/listings', { method: 'POST', body: { productId: product.id, marketplaces, notes: f.get('notes') || undefined, priority: f.get('priority') } });
      const text = r.results.map((x) => `${mpName(x.marketplace)}: ${x.created ? 'request received' : x.reason}`).join('\n');
      onDone({ kind: r.results.some((x) => x.created) ? 'ok' : 'err', text });
    } catch (err) { setError(errText(err)); setBusy(false); }
  }
  return (
    <Modal title={`Request new listing: ${product.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-3">Each marketplace counts once against your monthly new-listing limit. If your product already exists on the marketplace, we&apos;ll map it instead — mapping doesn&apos;t use your limit.</p>
        <div className="flex gap-6 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="mp" value="AMAZON" defaultChecked /> Amazon</label><label className="flex items-center gap-2"><input type="checkbox" name="mp" value="FLIPKART" /> Flipkart</label></div>
        <div><label className="label" htmlFor="rl-pri">Urgency</label><select id="rl-pri" name="priority" className="input" defaultValue="P3"><option value="P2">High</option><option value="P3">Normal</option><option value="P4">Low</option></select></div>
        <div><label className="label" htmlFor="rl-notes">Notes for your manager</label><textarea id="rl-notes" name="notes" className="input min-h-20" placeholder="Launch date, competitor links, keywords you want…" /></div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit'}</button></div>
      </form>
    </Modal>
  );
}

function MappingPanel({ onFlash }: { onFlash: (m: FlashMsg) => void }) {
  const rows = useApi<Mapping[]>('/mappings');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true);
    const form = e.currentTarget; const f = new FormData(form);
    const items = String(f.get('items') ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [identifier, sellerSku, productName] = l.split(',').map((x) => x.trim());
      return { identifier, ...(sellerSku ? { sellerSku } : {}), ...(productName ? { productName } : {}) };
    });
    try {
      const r = await api<{ created: number; update?: string }>('/mappings', { method: 'POST', body: { marketplace: f.get('marketplace'), items } });
      onFlash(r.created ? { kind: 'ok', text: `${r.created} product${r.created > 1 ? 's' : ''} sent for mapping.` } : { kind: 'err', text: r.update ?? 'Mapping request could not start.' });
      form.reset(); rows.reload();
    } catch (err) { onFlash({ kind: 'err', text: errText(err) }); }
    setBusy(false);
  }
  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="card space-y-3 p-6">
        <h2 className="font-semibold">Map products to existing ASINs / FSNs</h2>
        <p className="text-xs text-ink-3">Unlimited on every plan. One product per line: <code>ASIN/FSN or product name, your SKU, product name</code>.</p>
        <select name="marketplace" className="input sm:w-48" aria-label="Marketplace"><option value="AMAZON">Amazon</option><option value="FLIPKART">Flipkart</option></select>
        <textarea name="items" className="input min-h-28 font-mono text-xs" required placeholder={'B07ABC1234, LAMP-1, Brass Table Lamp\nBrass Diya Set of 4, BD-4'} aria-label="Products to map" />
        <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Submit for mapping'}</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wider text-ink-3"><th className="p-3">Submitted</th><th>Marketplace</th><th>Your SKU</th><th>Result</th><th>Matched ID</th><th>Notes</th></tr></thead>
          <tbody>
            {rows.data?.map((m) => (
              <tr key={m.id} className="border-t border-ink/5">
                <td className="p-3">{m.identifier}</td><td>{mpName(m.marketplace)}</td><td>{m.sellerSku ?? '—'}</td><td><Status s={m.status} label={m.status === 'NOT_ASSESSED' ? 'In review' : human(m.status)} /></td><td>{m.candidateId ?? '—'}</td><td className="max-w-xs text-xs text-ink-3">{m.note}</td>
              </tr>
            ))}
            {rows.data && !rows.data.length && <tr><td className="p-4 text-ink-3" colSpan={6}>No mapping requests yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-3">High-confidence matches are checked by a SOLLUNA reviewer before anything is uploaded to your account.</p>
    </div>
  );
}
