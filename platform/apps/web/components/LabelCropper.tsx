'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { compose, detect, manualPieces, type Box, type Layout, type PageText } from '../../../packages/labels/src';
import { SubTabs } from './ui';
import { api, ApiError } from '@/lib/api';
import { Status } from './ui';

type Mode = 'AUTO' | 'SPECIAL' | 'MANUAL';
interface Job { id: string; mode: string; layout: string; includeInvoices: boolean; fileName: string; status: string; marketplace: string | null; labelCount: number; invoiceCount: number; unrecognisedPages: number[]; reviewPages: number[]; error: string | null; createdAt: string; expiresAt: string }

type Market = 'FLIPKART' | 'AMAZON' | 'OTHER';
type Apply = 'ALL' | 'ODD' | 'EVEN';
/** Each marketplace is cropped its own way (original SOLLUNA label cropper). */
const MARKETS: Record<Market, { name: string; how: string; layouts: Layout[]; specialised: boolean; invoices: boolean; preset: { box: 'FLIPKART' | 'FULL' | 'TOP_HALF'; apply: Apply } }> = {
  FLIPKART: { name: 'Flipkart', how: 'Upload the Flipkart "invoice_labels" PDF: the label on the top half of each page is kept, the tax invoice below is removed.', layouts: ['A4_4UP', 'A4_6UP', 'SINGLE', 'THERMAL_4X6'], specialised: true, invoices: true, preset: { box: 'FLIPKART', apply: 'ALL' } },
  AMAZON: { name: 'Amazon', how: 'Upload the Amazon label PDF: each label page is paired with the tax invoice page after it; the invoice is removed.', layouts: ['A4_4UP', 'SINGLE', 'THERMAL_4X6'], specialised: true, invoices: true, preset: { box: 'FULL', apply: 'ODD' } },
  OTHER: { name: 'Other courier', how: 'Any other courier label PDF. We look for the label edge (cut line, border, invoice text) on every page.', layouts: ['A4_4UP', 'A4_6UP', 'THERMAL_4X6'], specialised: false, invoices: false, preset: { box: 'TOP_HALF', apply: 'ALL' } },
};
const MODE_INFO: Record<Mode, { title: string; body: (m: Market) => string; plan: string }> = {
  AUTO: { title: 'Auto crop', body: (m) => (m === 'AMAZON' ? 'We find every label, drop the invoices and add the item name, SKU and qty line on each label.' : 'We find every label, drop the invoices and lay the labels out to print.'), plan: 'Growth' },
  SPECIAL: { title: 'Auto + specialised', body: (m) => (m === 'AMAZON' ? 'Auto crop with the item line, labels sorted by SKU, plus a picklist page.' : 'Auto crop plus a product description & qty box under each label, sorted by SKU, with a picklist page.'), plan: 'Premium' },
  MANUAL: { title: 'Manual crop', body: (m) => (m === 'AMAZON' ? 'Adjust the label box once; the item name, SKU and qty line is added from each invoice.' : 'Adjust the label box on the preview once; it is applied to every label page.'), plan: 'All plans' },
};
const LAYOUT_NAME: Record<Layout, string> = { A4_4UP: '4 labels per A4', A4_6UP: '6 labels per A4', SINGLE: 'Single labels (one per page)', THERMAL_4X6: '1 label per page (4×6 thermal)' };

/** Label Cropping Tool. Auto / specialised run on the server (plan-checked); manual runs entirely in the browser. */
export function LabelCropper() {
  const [modes, setModes] = useState<Mode[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [market, setMarket] = useState<Market>('FLIPKART');
  const [mode, setMode] = useState<Mode>('MANUAL');
  const [layout, setLayout] = useState<Layout>('A4_4UP');
  const [invoices, setInvoices] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const load = useCallback(async () => {
    const r = await api<{ modes: Mode[]; jobs: Job[] }>('/label-crops');
    setModes(r.modes); setJobs(r.jobs);
    return r;
  }, []);
  useEffect(() => { load().then((r) => setMode(r.modes.includes('SPECIAL') ? 'SPECIAL' : r.modes.includes('AUTO') ? 'AUTO' : 'MANUAL')).catch(() => setModes([])); }, [load]);
  const pending = jobs.some((j) => j.status === 'QUEUED' || j.status === 'PROCESSING');
  useEffect(() => { if (!pending) return; const t = setInterval(() => { load().catch(() => undefined); }, 2500); return () => clearInterval(t); }, [pending, load]);

  const cfg = MARKETS[market];
  const allowedHere = (m: Mode) => Boolean(modes?.includes(m)) && (m !== 'SPECIAL' || cfg.specialised);
  function switchMarket(m: Market) {
    setMarket(m); setFile(null); setMsg({});
    if (!MARKETS[m].layouts.includes(layout)) setLayout('A4_4UP');
    if (mode === 'SPECIAL' && !MARKETS[m].specialised) setMode(modes?.includes('AUTO') ? 'AUTO' : 'MANUAL');
  }

  async function submitAuto() {
    if (!file) return setMsg({ err: 'Choose the label PDF first.' });
    setBusy(true); setMsg({});
    const fd = new FormData();
    fd.append('file', file); fd.append('marketplace', market); fd.append('mode', mode); fd.append('layout', layout); fd.append('includeInvoices', String(invoices && cfg.invoices));
    try {
      const r = await fetch('/api/label-crops', { method: 'POST', body: fd, credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new ApiError(r.status, Array.isArray(j.message) ? j.message.join(', ') : j.message ?? `Upload failed (${r.status})`);
      setMsg({ ok: 'Uploaded. Your print-ready file will appear below in a few seconds.' });
      setFile(null);
      await load();
    } catch (e) { setMsg({ err: (e as Error).message }); }
    setBusy(false);
  }

  if (!modes) return <p className="text-sm text-ink-3">Loading…</p>;
  return (
    <div className="space-y-6">
      <section className="card space-y-5 p-6" aria-label="Label cropper">
        <div><h2 className="font-semibold">Crop your marketplace labels</h2><p className="text-xs text-ink-3">Official labels are only cropped and arranged for printing — barcodes and addresses are never edited.</p></div>
        <SubTabs tabs={[['FLIPKART', 'Flipkart'], ['AMAZON', 'Amazon'], ['OTHER', 'Other courier']] as const} value={market} onChange={switchMarket} />
        <p className="text-sm text-ink-2">{cfg.how}</p>
        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Crop mode">
          {(['AUTO', 'SPECIAL', 'MANUAL'] as Mode[]).filter((m) => m !== 'SPECIAL' || cfg.specialised).map((m) => {
            const on = allowedHere(m);
            return (
              <label key={m} className={`card flex cursor-pointer flex-col gap-1 p-4 ${mode === m ? 'ring-2 ring-ink' : ''} ${on ? '' : 'cursor-not-allowed opacity-60'}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="crop-mode" value={m} checked={mode === m} disabled={!on} onChange={() => setMode(m)} />{MODE_INFO[m].title}</span>
                  {!on && <span className="chip bg-ink/5 text-ink-3">{MODE_INFO[m].plan}</span>}
                </span>
                <span className="text-xs text-ink-3">{MODE_INFO[m].body(market)}</span>
              </label>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
          <div><label className="label" htmlFor="crop-file">{cfg.name} label PDF</label><input key={market} id="crop-file" type="file" accept="application/pdf,.pdf" className="input" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMsg({}); }} /></div>
          <div><label className="label" htmlFor="crop-layout">Print layout</label>
            <select id="crop-layout" className="input" value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>{cfg.layouts.map((v) => <option key={v} value={v}>{LAYOUT_NAME[v]}</option>)}</select></div>
        </div>
        {mode !== 'MANUAL' && (
          <>
            {cfg.invoices && <label className="flex items-center gap-2 text-sm"><input id="crop-invoices" type="checkbox" checked={invoices} onChange={(e) => setInvoices(e.target.checked)} /> Also include the tax invoices (to pack inside each parcel)</label>}
            <button className="btn-primary" disabled={busy || !file} onClick={submitAuto}>{busy ? 'Uploading…' : !file ? 'Choose a PDF to crop' : mode === 'SPECIAL' ? `Crop ${cfg.name} labels with description boxes` : `Crop ${cfg.name} labels`}</button>
          </>
        )}
        {mode === 'MANUAL' && !file && <p className="rounded-xl bg-ivory px-3 py-2 text-sm text-ink-2">Choose the PDF above — a preview opens with the label area already marked.</p>}
        {mode === 'MANUAL' && file && <ManualCrop key={`${market}:${file.name}:${file.size}`} file={file} layout={layout} preset={cfg.preset} amazon={market === 'AMAZON'} onDone={(t) => setMsg({ ok: t })} onError={(t) => setMsg({ err: t })} />}
        {msg.ok && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{msg.ok}</p>}
        {msg.err && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{msg.err}</p>}
      </section>

      {jobs.length > 0 && (
        <section className="card overflow-x-auto p-6" aria-label="Cropped files">
          <h2 className="font-semibold">Your cropped files</h2>
          <p className="text-xs text-ink-3">Kept for 7 days. The PDF you upload is deleted as soon as it is processed.</p>
          <ul className="mt-3 divide-y divide-ink/5">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{j.fileName}</p>
                  <p className="text-xs text-ink-3">
                    {j.marketplace ? `${MARKETS[j.marketplace as Market]?.name ?? j.marketplace} · ` : ''}{j.mode === 'SPECIAL' ? 'Specialised' : 'Auto'} · {LAYOUT_NAME[j.layout as Layout] ?? j.layout} · {new Date(j.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    {j.status === 'DONE' && ` · ${j.labelCount} labels`}
                  </p>
                  {(j.unrecognisedPages ?? []).length > 0 && <p className="text-xs text-amber-800">Pages {j.unrecognisedPages.join(', ')} could not be cropped automatically — use Manual crop for them.</p>}
                  {(j.reviewPages ?? []).length > 0 && <p className="text-xs text-amber-800">Please check pages {j.reviewPages.join(', ')} (lower confidence).</p>}
                  {j.error && <p className="text-xs text-red-800">{j.error}</p>}
                </div>
                {j.status === 'DONE' ? <a className="btn-primary py-1.5 text-xs" href={`/api/label-crops/${j.id}/download`}>Download PDF</a> : <Status s={j.status} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const PREVIEW_W = 520;

/** Text layer of every page, in PDF points (same shape the server uses). */
async function readPages(doc: { pages: number; get: (n: number) => Promise<unknown> }): Promise<PageText[]> {
  const out: PageText[] = [];
  for (let n = 1; n <= doc.pages; n++) {
    const page = (await doc.get(n)) as { view: number[]; getTextContent: () => Promise<{ items: { str?: string; transform?: number[]; width?: number; height?: number }[] }> };
    const [x0, y0, x1, y1] = page.view;
    const tc = await page.getTextContent();
    out.push({
      width: x1 - x0, height: y1 - y0,
      items: tc.items.flatMap((it) => (it.str?.trim() && it.transform ? [{ str: it.str, x: it.transform[4] - x0, y: it.transform[5] - y0, w: it.width ?? 0, h: it.height ?? 0, rotated: Math.abs(it.transform[1]) > 0.01 }] : [])),
    });
  }
  return out;
}

/**
 * Browser-only manual crop: preview with pdf.js, draw the label box, lay out with the shared composer.
 * FROZEN — approved by the owner on 6 Nov 2026 ("perfect, never change"). Do not change its behaviour or output
 * without the owner's explicit approval.
 */
/** Standard Flipkart label position on the A4 "invoice_labels" page (points, bottom-left origin). */
const FLIPKART_LABEL: Box = { x: 186, y: 458, w: 221, h: 359 };

function ManualCrop({ file, layout, preset, amazon, onDone, onError }: { file: File; layout: Layout; preset: { box: 'FLIPKART' | 'FULL' | 'TOP_HALF'; apply: Apply }; amazon: boolean; onDone: (m: string) => void; onError: (m: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<{ pages: number; get: (n: number) => Promise<unknown> } | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [view, setView] = useState<{ scale: number; w: number; h: number; ox: number; oy: number } | null>(null);
  const [sel, setSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [apply, setApply] = useState<Apply>(preset.apply);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const d = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        if (!cancelled) { setDoc({ pages: d.numPages, get: (n) => d.getPage(n) }); setPageNo(1); setSel(null); }
      } catch { onError('This PDF could not be opened. Download it again from the marketplace and retry.'); }
    })();
    return () => { cancelled = true; };
  }, [file, onError]);

  useEffect(() => {
    if (!doc || !canvas.current) return;
    let task: { cancel: () => void } | null = null;
    (async () => {
      const page = (await doc.get(pageNo)) as { view: number[]; getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: object) => { promise: Promise<void>; cancel: () => void } };
      const base = page.getViewport({ scale: 1 });
      const scale = PREVIEW_W / base.width;
      const vp = page.getViewport({ scale });
      const c = canvas.current!;
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      setView({ scale, w: vp.width, h: vp.height, ox: page.view[0], oy: page.view[1] });
      // Start with the usual label area marked, so the client only adjusts it.
      setSel((cur) => {
        if (cur) return cur;
        const pw = base.width, ph = base.height;
        const b: Box = preset.box === 'FULL' ? { x: 0, y: 0, w: pw, h: ph } : preset.box === 'TOP_HALF' ? { x: 0, y: ph / 2, w: pw, h: ph / 2 } : FLIPKART_LABEL;
        return { x: b.x * scale, y: (ph - b.y - b.h) * scale, w: b.w * scale, h: b.h * scale };
      });
      task = page.render({ canvasContext: c.getContext('2d')!, viewport: vp, canvas: c });
      await (task as unknown as { promise: Promise<void> }).promise.catch(() => undefined);
    })();
    return () => task?.cancel();
  }, [doc, pageNo]);

  const point = (e: React.PointerEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) }; };

  async function generate() {
    if (!doc || !view || !sel || sel.w < 10 || sel.h < 10) return onError('Draw a box around the label on the preview first.');
    setBusy(true);
    try {
      // Preview pixels (top-left origin) → PDF points (bottom-left origin).
      const box: Box = { x: view.ox + sel.x / view.scale, y: view.oy + (view.h - sel.y - sel.h) / view.scale, w: sel.w / view.scale, h: sel.h / view.scale };
      const pieces = manualPieces(doc.pages, box, apply);
      let withLine = 0;
      if (amazon) {
        // Amazon: read each label's invoice page (in the browser) for the item name, SKU and qty line.
        const found = detect(await readPages(doc));
        const items = new Map(found.labels.filter((l) => l.marketplace === 'AMAZON').map((l) => [l.page, l.items]));
        for (const p of pieces) { p.items = items.get(p.page) ?? []; if (p.items.length) withLine++; }
      }
      const out = await compose(new Uint8Array(await file.arrayBuffer()), pieces, [], { layout, specialised: false, includeInvoices: false, style: amazon ? 'AMAZON' : 'GENERIC', itemBox: amazon });
      const url = URL.createObjectURL(new Blob([out as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${file.name.replace(/\.pdf$/i, '')}-cropped.pdf`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      onDone(`Done — ${pieces.length} labels cropped${amazon ? ` (item line on ${withLine})` : ''}. Your download has started.`);
    } catch { onError('Could not build the PDF. Try a smaller box or another file.'); }
    setBusy(false);
  }

  if (!doc) return <p className="text-sm text-ink-3">Opening preview…</p>;
  return (
    <div className="space-y-3" aria-label="Manual crop">
      <p className="text-sm">The yellow box marks the label. If it is not exactly around <strong>one label</strong>, drag a new box on the preview. The same area is cropped on every chosen page.</p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button className="btn-ghost py-1 text-xs" disabled={pageNo <= 1} onClick={() => setPageNo(pageNo - 1)}>Previous page</button>
        <span>Page {pageNo} of {doc.pages}</span>
        <button className="btn-ghost py-1 text-xs" disabled={pageNo >= doc.pages} onClick={() => setPageNo(pageNo + 1)}>Next page</button>
        <label className="ml-auto flex items-center gap-2" htmlFor="crop-apply">Apply to
          <select id="crop-apply" className="input w-auto py-1" value={apply} onChange={(e) => setApply(e.target.value as Apply)}>
            <option value="ALL">every page</option><option value="ODD">odd pages (1, 3, 5…) — Amazon labels</option><option value="EVEN">even pages (2, 4, 6…)</option>
          </select>
        </label>
      </div>
      <div className="max-w-full overflow-auto rounded-xl border border-ink/10 bg-ivory p-2">
        <div className="relative inline-block touch-none select-none" data-testid="crop-surface" style={{ width: view?.w, height: view?.h }}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); const p = point(e); setDrag(p); setSel({ x: p.x, y: p.y, w: 0, h: 0 }); }}
          onPointerMove={(e) => { if (!drag) return; const p = point(e); setSel({ x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) }); }}
          onPointerUp={() => setDrag(null)}>
          <canvas ref={canvas} className="block bg-white" aria-label={`Page ${pageNo} preview`} />
          {sel && <div className="pointer-events-none absolute border-2 border-sun bg-sun/10" style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }} />}
        </div>
      </div>
      <button className="btn-primary" disabled={busy} onClick={generate}>{busy ? 'Building PDF…' : 'Crop and download'}</button>
      <p className="text-xs text-ink-3">Manual crop runs in your browser — the file never leaves your computer.</p>
    </div>
  );
}
