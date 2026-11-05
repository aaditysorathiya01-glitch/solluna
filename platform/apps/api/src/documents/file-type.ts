/**
 * Detects the real file type from its bytes (never trusts the name or the browser's content-type).
 * Allow-list only: PDF, PNG, JPEG, WEBP, XLSX, DOCX, CSV, TXT. Everything else — executables, HTML,
 * SVG (can carry script), archives, macro formats — is rejected.
 */
export interface Detected { mime: string; ext: string }

const startsWith = (b: Buffer, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

export function detectFileType(buf: Buffer, fileName: string): Detected | null {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  if (buf.length === 0) return null;
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', ext: 'pdf' };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: 'image/webp', ext: 'webp' };
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    // Office Open XML is a zip whose entries include [Content_Types].xml and a word/ or xl/ folder.
    const head = buf.subarray(0, Math.min(buf.length, 64 * 1024)).toString('latin1');
    if (!head.includes('[Content_Types].xml')) return null;
    if (head.includes('vbaProject.bin')) return null; // macro-enabled content
    if (ext === 'xlsx' && head.includes('xl/')) return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
    if (ext === 'docx' && head.includes('word/')) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
    return null;
  }
  if (ext === 'csv' || ext === 'txt') {
    if (buf.includes(0)) return null; // binary
    const text = buf.toString('utf8');
    if (text.includes('�')) return null; // not valid UTF-8
    if (/<\s*(script|html|svg|iframe)/i.test(text.slice(0, 4096))) return null;
    return ext === 'csv' ? { mime: 'text/csv', ext: 'csv' } : { mime: 'text/plain', ext: 'txt' };
  }
  return null;
}

export const ALLOWED_DESCRIPTION = 'PDF, PNG, JPG, WEBP, XLSX, DOCX, CSV or TXT';

/** Safe download name: keeps letters, digits, dot, dash, underscore; forces the detected extension. */
export function safeFileName(name: string, ext: string): string {
  const base = name.replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'file';
  return `${base}.${ext}`;
}
