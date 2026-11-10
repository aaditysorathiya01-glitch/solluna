import { inflateRawSync } from 'zlib';

/**
 * Minimal, dependency-free .xlsx reader (an .xlsx file is a zip of XML parts). Reads every sheet into rows of cell
 * values: shared strings, inline strings and numbers. Enough for marketplace reports; no formulas are evaluated
 * (Excel stores the last computed value, which is what we read). Rejects anything that is not a valid workbook.
 */
export type Cell = string | number | null;
export type Workbook = Record<string, Cell[][]>;

const MAX_ENTRY = 50 * 1024 * 1024;

function unzip(buf: Buffer): Map<string, Buffer> {
  // Find the end-of-central-directory record (last 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not an Excel (.xlsx) file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Damaged Excel file');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28); const extraLen = buf.readUInt16LE(p + 30); const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.(xml|rels)$/i.test(name)) continue;
    if (size > MAX_ENTRY) throw new Error('Excel file too large');
    const lNameLen = buf.readUInt16LE(local + 26); const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    out.set(name, method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_ENTRY }) : Buffer.alloc(0));
  }
  return out;
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1])).join('');
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

export function readXlsx(buf: Buffer): Workbook {
  const files = unzip(buf);
  const wbXml = files.get('xl/workbook.xml')?.toString('utf8');
  const relsXml = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (!wbXml || !relsXml) throw new Error('Not an Excel (.xlsx) file');
  const shared = [...(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rels = new Map([...relsXml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  const out: Workbook = {};
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescape(/name="([^"]*)"/.exec(m[0])?.[1] ?? '');
    const target = rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1]);
    if (!target) continue;
    const xml = files.get(target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`)?.toString('utf8') ?? '';
    const rows: Cell[][] = [];
    for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowNum = Number(/\br="(\d+)"/.exec(r[0])?.[1] ?? rows.length + 1) - 1;
      const row: Cell[] = [];
      for (const c of (r[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(c[1])?.[1];
        const type = /t="([^"]+)"/.exec(c[1])?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? '')?.[1];
        let val: Cell = null;
        if (type === 's') val = v !== undefined ? shared[Number(v)] ?? null : null;
        else if (type === 'inlineStr') val = texts(c[2] ?? '');
        else if (type === 'str' || type === 'e') val = v !== undefined ? unescape(v) : null;
        else if (type === 'b') val = v === '1' ? 1 : 0;
        else if (v !== undefined) { const n = Number(v); val = Number.isFinite(n) ? n : unescape(v); }
        row[ref ? colIndex(ref) : row.length] = val;
      }
      rows[rowNum] = Array.from(row, (x) => (x === undefined ? null : x));
    }
    out[name] = Array.from(rows, (x) => x ?? []);
  }
  return out;
}
