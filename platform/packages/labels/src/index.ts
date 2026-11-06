/**
 * Label cropping for marketplace shipping-label PDFs (Flipkart "invoice_labels", Amazon label + invoice).
 * Used by the API worker (auto / specialised) and by the browser (manual crop), so both produce identical files.
 *
 * Rules (skill: shipping-label-generation, CLAUDE.md non-negotiable 8):
 * - Official labels are never altered: each label region is embedded as vector content and scaled uniformly.
 *   Nothing is drawn on top of a label; the specialised SKU/qty line sits outside the label's box.
 * - Tax invoices are kept, not discarded, when the client asks for them (they go inside the package).
 */
import { PDFDocument, PDFPage, StandardFonts, rgb, type PDFEmbeddedPage, type PDFFont } from 'pdf-lib';

export interface TextItem { str: string; x: number; y: number; w: number; h: number; rotated: boolean }
export interface PageText { width: number; height: number; items: TextItem[] }
/** PDF user-space rectangle, origin bottom-left. */
export interface Box { x: number; y: number; w: number; h: number }
export interface LineItem { sku: string; name: string; qty: number }
export type Marketplace = 'FLIPKART' | 'AMAZON' | 'UNKNOWN';
export interface LabelPiece { page: number; box: Box; marketplace: Marketplace; orderId: string | null; items: LineItem[] }
export interface InvoicePiece { page: number; box: Box }
export interface Detection { marketplace: Marketplace | 'MIXED'; labels: LabelPiece[]; invoices: InvoicePiece[]; unrecognisedPages: number[] }
export type Layout = 'A4_4UP' | 'A4_6UP' | 'THERMAL_4X6';
export interface ComposeOptions { layout: Layout; specialised: boolean; includeInvoices: boolean; generatedAt?: Date }

const has = (p: PageText, re: RegExp) => p.items.some((i) => re.test(i.str));
const find = (p: PageText, re: RegExp) => p.items.find((i) => re.test(i.str));

/** Groups items into visual lines (top to bottom), each sorted left to right. */
function lines(items: TextItem[], tol = 3): TextItem[][] {
  const sorted = [...items].filter((i) => !i.rotated && i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const out: TextItem[][] = [];
  for (const it of sorted) {
    const line = out.find((l) => Math.abs(l[0].y - it.y) <= tol);
    if (line) line.push(it); else out.push([it]);
  }
  out.forEach((l) => l.sort((a, b) => a.x - b.x));
  return out.sort((a, b) => b[0].y - a[0].y);
}

function flipkartItems(p: PageText): LineItem[] {
  const header = find(p, /SKU ID\s*\|\s*Description/i);
  const qtyHead = p.items.find((i) => /^QTY$/i.test(i.str.trim()) && header && Math.abs(i.y - header.y) < 3);
  const tracking = p.items.filter((i) => header && i.y < header.y && /^FM[A-Z]{2}\d{6,}$/.test(i.str.trim())).sort((a, b) => b.y - a.y)[0];
  if (!header) return [];
  const bottom = tracking ? tracking.y : header.y - 60;
  const qtyX = qtyHead ? qtyHead.x - 6 : Infinity;
  const rows: { desc: string[]; qty: number }[] = [];
  for (const line of lines(p.items.filter((i) => i.y < header.y - 1 && i.y > bottom + 1))) {
    const first = line[0];
    const isNew = /^\d+$/.test(first.str.trim()) && first.x < header.x - 20;
    const desc = line.filter((i) => i !== (isNew ? first : null) && i.x < qtyX).map((i) => i.str.trim()).join(' ');
    const qty = Number(line.filter((i) => i.x >= qtyX).map((i) => i.str.trim()).join('')) || 0;
    if (isNew || !rows.length) rows.push({ desc: [desc], qty });
    else { rows[rows.length - 1].desc.push(desc); if (qty) rows[rows.length - 1].qty = qty; }
  }
  return rows.map((r) => {
    const text = r.desc.join(' ').replace(/\s+/g, ' ').trim();
    const [sku, ...rest] = text.split('|');
    return { sku: sku.trim(), name: rest.join('|').trim() || sku.trim(), qty: r.qty || 1 };
  }).filter((r) => r.sku);
}

export function amazonInvoiceItems(p: PageText): LineItem[] {
  const header = find(p, /^Description$/);
  if (!header) return [];
  // The totals row ("TOTAL:"), not the "Total Amount" column header.
  const total = p.items.filter((i) => /^TOTAL:?$/.test(i.str.trim()) && i.y < header.y - 5).sort((a, b) => b.y - a.y)[0];
  const floor = total ? total.y : 0;
  const rowStarts = p.items.filter((i) => /^\d+$/.test(i.str.trim()) && i.x < header.x - 2 && i.y < header.y - 5 && i.y > floor).sort((a, b) => b.y - a.y);
  return rowStarts.map((r, k) => {
    const top = r.y + 6, bottom = k + 1 < rowStarts.length ? rowStarts[k + 1].y + 6 : floor + 2;
    const inRow = p.items.filter((i) => i.y <= top && i.y > bottom);
    const descEnd = p.items.find((i) => /^Unit$/i.test(i.str.trim()))?.x ?? header.x + 280;
    const desc = inRow.filter((i) => i.x >= header.x - 2 && i.x < descEnd - 2).sort((a, b) => b.y - a.y || a.x - b.x).map((i) => i.str.trim()).join(' ')
      .replace(/\s*HSN:\s*\d+.*$/i, '').replace(/\s+/g, ' ').trim();
    const qtyText = inRow.filter((i) => i.x >= descEnd - 2).map((i) => i.str).join(' ');
    const qty = Number(/₹\s*[\d,.]+\s+(\d+)\b/.exec(qtyText)?.[1] ?? 1);
    const [name, ref = ''] = desc.split(/\s\|\s(?=[^|]*$)/);
    const sku = /\(\s*([^)]+?)\s*\)/.exec(ref)?.[1] ?? (ref.trim() || name.slice(0, 24));
    return { sku: sku.trim(), name: name.trim(), qty };
  });
}

const amazonOrderId = (p: PageText) => {
  const i = p.items.findIndex((x) => /Order Number/i.test(x.str));
  const m = /(\d{3}-\d{7}-\d{7})/.exec(p.items.slice(i, i + 3).map((x) => x.str).join(' '));
  return m?.[1] ?? null;
};

/** Finds every label (and its invoice) in a marketplace label PDF from the pages' text layer. */
export function detect(pages: PageText[]): Detection {
  const labels: LabelPiece[] = [];
  const invoices: InvoicePiece[] = [];
  const unrecognised: number[] = [];
  const amazonInvoice = (p: PageText) => has(p, /Tax Invoice\/Bill of Supply/i);
  const anyAmazon = pages.some(amazonInvoice);

  pages.forEach((p, idx) => {
    const tax = find(p, /^Tax Invoice$/i);
    const isFlipkart = tax && has(p, /Not for resale|Ordered through|E-Kart/i);
    if (isFlipkart) {
      const cut = tax.y + tax.h;
      const top = p.items.filter((i) => i.y > cut + 2);
      const xs = top.map((i) => i.x), xe = top.map((i) => i.x + (i.rotated ? i.h : i.w));
      const ys = top.map((i) => i.y), ye = top.map((i) => i.y + (i.rotated ? i.w : i.h));
      const pad = 4;
      const x = Math.max(0, Math.min(...xs) - pad), right = Math.min(p.width, Math.max(...xe) + pad);
      const y = Math.max(cut + 8, Math.min(...ys) - 8), upper = Math.min(p.height, Math.max(...ye) + pad);
      const od = /OD\d{15,}/.exec(top.map((i) => i.str).join(' '))?.[0] ?? null;
      labels.push({ page: idx, box: { x, y, w: right - x, h: upper - y }, marketplace: 'FLIPKART', orderId: od, items: flipkartItems(p) });
      invoices.push({ page: idx, box: { x: 0, y: 0, w: p.width, h: Math.min(cut + 7, y) } });
    } else if (amazonInvoice(p)) {
      invoices.push({ page: idx, box: { x: 0, y: 0, w: p.width, h: p.height } });
      const label = [...labels].reverse().find((l) => l.marketplace === 'AMAZON' && !l.items.length && l.page < idx);
      if (label) { label.items = amazonInvoiceItems(p); label.orderId = amazonOrderId(p); }
    } else if (anyAmazon) {
      // Amazon label pages carry no text layer: the whole page is the label; its invoice usually follows.
      labels.push({ page: idx, box: { x: 0, y: 0, w: p.width, h: p.height }, marketplace: 'AMAZON', orderId: null, items: [] });
    } else {
      // Other formats (and label-only PDFs) go to the hybrid detector.
      unrecognised.push(idx);
    }
  });
  const kinds = new Set(labels.map((l) => l.marketplace));
  return { marketplace: kinds.size > 1 ? 'MIXED' : ([...kinds][0] ?? 'UNKNOWN'), labels, invoices, unrecognisedPages: unrecognised };
}

/** Same box on chosen pages — the manual crop. */
export function manualPieces(pageCount: number, box: Box, apply: 'ALL' | 'ODD' | 'EVEN'): LabelPiece[] {
  return Array.from({ length: pageCount }, (_, i) => i)
    .filter((i) => apply === 'ALL' || (apply === 'ODD' ? i % 2 === 0 : i % 2 === 1))
    .map((page) => ({ page, box, marketplace: 'UNKNOWN' as const, orderId: null, items: [] }));
}

const A4 = { w: 595.28, h: 841.89 };
const THERMAL = { w: 288, h: 432 };
/** Standard fonts only support WinAnsi; keep text printable. */
const safe = (s: string) => s.replace(/₹/g, 'Rs ').replace(/[·–—]/g, '-').replace(/[^\x20-\x7E]/g, '?');
const headerText = (l: LabelPiece) => l.items.map((i) => `${i.sku} | ${i.name} | Qty ${i.qty}`).join('  ;  ') || (l.orderId ?? '');
function fit(font: PDFFont, text: string, size: number, width: number) {
  let t = safe(text);
  while (t.length > 3 && font.widthOfTextAtSize(t, size) > width) t = `${t.slice(0, -4)}...`;
  return t;
}

/** Builds the print-ready PDF: labels (and optionally invoices) laid out for A4 4-up or 4x6 thermal printing. */
export async function compose(src: Uint8Array | ArrayBuffer, labelsIn: LabelPiece[], invoices: InvoicePiece[], opts: ComposeOptions): Promise<Uint8Array> {
  const source = await PDFDocument.load(src, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  out.setTitle('SOLLUNA labels'); out.setProducer('SOLLUNA label cropper'); out.setCreator('SOLLUNA');
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const cache = new Map<string, PDFEmbeddedPage>();
  const embed = async (page: number, b: Box) => {
    const key = `${page}:${b.x}:${b.y}:${b.w}:${b.h}`;
    if (!cache.has(key)) cache.set(key, await out.embedPage(source.getPage(page), { left: b.x, bottom: b.y, right: b.x + b.w, top: b.y + b.h }));
    return cache.get(key)!;
  };
  const labels = opts.specialised
    ? [...labelsIn].sort((a, b) => (a.items[0]?.sku ?? '~').localeCompare(b.items[0]?.sku ?? '~') || (a.items[0]?.name ?? '').localeCompare(b.items[0]?.name ?? '') || a.page - b.page)
    : labelsIn;

  if (opts.specialised) drawPicklist(out, labels, font, bold, opts);

  const HEADER = opts.specialised ? 13 : 0;
  const place = async (page: PDFPage, l: LabelPiece, cx: number, cy: number, cw: number, ch: number, margin: number) => {
    const emb = await embed(l.page, l.box);
    const aw = cw - margin * 2, ah = ch - margin * 2 - HEADER;
    const s = Math.min(aw / l.box.w, ah / l.box.h);
    const w = l.box.w * s, h = l.box.h * s;
    const x = cx + (cw - w) / 2, y = cy + margin + (ah - h) / 2;
    page.drawPage(emb, { x, y, xScale: s, yScale: s });
    if (opts.specialised) {
      const text = headerText(l);
      if (text) page.drawText(fit(bold, text, 7, w), { x, y: y + h + 4, size: 7, font: bold, color: rgb(0, 0, 0) });
    }
  };

  if (opts.layout === 'THERMAL_4X6') {
    for (const l of labels) { const p = out.addPage([THERMAL.w, THERMAL.h]); await place(p, l, 0, 0, THERMAL.w, THERMAL.h, 6); }
  } else {
    // A4 grid: 2 x 2 (4-in-1) or 2 x 3 (6-in-1), with dashed cut guides.
    const rows = opts.layout === 'A4_6UP' ? 3 : 2, per = rows * 2;
    const cw = A4.w / 2, ch = A4.h / rows;
    for (let i = 0; i < labels.length; i += per) {
      const p = out.addPage([A4.w, A4.h]);
      const dash = { color: rgb(0.6, 0.6, 0.6), thickness: 0.6, dashArray: [4, 3] };
      p.drawLine({ start: { x: cw, y: 0 }, end: { x: cw, y: A4.h }, ...dash });
      for (let r = 1; r < rows; r++) p.drawLine({ start: { x: 0, y: r * ch }, end: { x: A4.w, y: r * ch }, ...dash });
      for (let k = 0; k < per && i + k < labels.length; k++) {
        const col = k % 2, row = Math.floor(k / 2);
        await place(p, labels[i + k], col * cw, A4.h - (row + 1) * ch, cw, ch, rows === 3 ? 10 : 14);
      }
    }
  }

  if (opts.includeInvoices && invoices.length) {
    // Invoices go in the package: full pages stay full pages; Flipkart invoice halves print two per A4.
    const halves = invoices.filter((v) => v.box.h < source.getPage(v.page).getHeight() * 0.75);
    const fulls = invoices.filter((v) => !halves.includes(v));
    for (let i = 0; i < halves.length; i += 2) {
      const p = out.addPage([A4.w, A4.h]);
      for (let k = 0; k < 2 && i + k < halves.length; k++) {
        const v = halves[i + k]; const emb = await embed(v.page, v.box);
        const s = Math.min((A4.w - 20) / v.box.w, (A4.h / 2 - 20) / v.box.h);
        p.drawPage(emb, { x: (A4.w - v.box.w * s) / 2, y: (k === 0 ? A4.h / 2 : 0) + (A4.h / 2 - v.box.h * s) / 2, xScale: s, yScale: s });
      }
    }
    for (const v of fulls) { const [copy] = await out.copyPages(source, [v.page]); out.addPage(copy); }
  }
  if (!out.getPageCount()) throw new Error('No labels found to lay out');
  return out.save();
}

function drawPicklist(out: PDFDocument, labels: LabelPiece[], font: PDFFont, bold: PDFFont, opts: ComposeOptions) {
  const totals = new Map<string, { sku: string; name: string; qty: number; orders: number }>();
  for (const l of labels) for (const it of l.items) {
    const t = totals.get(it.sku) ?? { sku: it.sku, name: it.name, qty: 0, orders: 0 };
    t.qty += it.qty; t.orders += 1; totals.set(it.sku, t);
  }
  const rows = [...totals.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  let page = out.addPage([A4.w, A4.h]);
  let y = A4.h - 50;
  const when = (opts.generatedAt ?? new Date()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  page.drawText('Picklist', { x: 40, y, size: 18, font: bold });
  page.drawText(safe(`${labels.length} labels · ${rows.reduce((s, r) => s + r.qty, 0)} units · ${when} IST`), { x: 40, y: y - 18, size: 9, font });
  y -= 50;
  const head = (p: PDFPage, yy: number) => { for (const [t, x] of [['SKU', 40], ['Product', 170], ['Qty', 470], ['Orders', 510]] as const) p.drawText(t, { x, y: yy, size: 9, font: bold }); };
  head(page, y); y -= 16;
  for (const r of rows.length ? rows : [{ sku: '-', name: 'No product details found on these labels', qty: 0, orders: 0 }]) {
    if (y < 50) { page = out.addPage([A4.w, A4.h]); y = A4.h - 50; head(page, y); y -= 16; }
    page.drawText(fit(font, r.sku, 9, 120), { x: 40, y, size: 9, font });
    page.drawText(fit(font, r.name, 9, 290), { x: 170, y, size: 9, font });
    page.drawText(String(r.qty), { x: 470, y, size: 9, font: bold });
    page.drawText(String(r.orders), { x: 510, y, size: 9, font });
    page.drawLine({ start: { x: 40, y: y - 5 }, end: { x: A4.w - 40, y: y - 5 }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) });
    y -= 16;
  }
}
