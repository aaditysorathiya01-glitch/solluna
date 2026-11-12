/** Minimal MIME reader for the ops mailbox: headers, subject and the first readable text part. No dependencies. */
export interface ParsedMail { from: string; to: string; subject: string; text: string }

function splitHead(raw: string): [string, string] {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m || m.index == null) return [raw, ''];
  return [raw.slice(0, m.index), raw.slice(m.index + m[0].length)];
}
function headers(head: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) { const k = line.slice(0, i).trim().toLowerCase(); if (!(k in out)) out[k] = line.slice(i + 1).trim(); }
  }
  return out;
}
function qp(s: string) {
  const bytes: number[] = [];
  const t = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9A-F]{2}$/i.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(t.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes).toString('utf8');
}
function decodeBody(body: string, enc = '') {
  const e = enc.toLowerCase();
  if (e.includes('base64')) return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (e.includes('quoted-printable')) return qp(body);
  return body;
}
/** RFC 2047 encoded words (=?utf-8?B?...?= / =?utf-8?Q?...?=). */
export function decodeWords(s: string) {
  return s.replace(/=\?[^?]+\?([BbQq])\?([^?]*)\?=/g, (_, k: string, v: string) =>
    k.toUpperCase() === 'B' ? Buffer.from(v, 'base64').toString('utf8') : qp(v.replace(/_/g, ' '))).replace(/\?=\s+=\?/g, '');
}
const stripHtml = (h: string) => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

function textOf(h: Record<string, string>, body: string, depth = 0): { plain?: string; html?: string } {
  const ct = h['content-type'] ?? 'text/plain';
  const boundary = ct.match(/boundary="?([^";]+)"?/i)?.[1];
  if (/^multipart\//i.test(ct) && boundary && depth < 5) {
    const found: { plain?: string; html?: string } = {};
    for (const part of body.split(`--${boundary}`).slice(1)) {
      if (part.startsWith('--')) break;
      const [ph, pb] = splitHead(part.replace(/^\r?\n/, ''));
      const r = textOf(headers(ph), pb, depth + 1);
      found.plain ??= r.plain; found.html ??= r.html;
    }
    return found;
  }
  if (/attachment/i.test(h['content-disposition'] ?? '')) return {};
  const decoded = decodeBody(body, h['content-transfer-encoding']);
  if (/^text\/html/i.test(ct)) return { html: stripHtml(decoded) };
  if (/^text\/plain/i.test(ct)) return { plain: decoded.trim() };
  return {};
}

export function parseMail(raw: string): ParsedMail {
  const [head, body] = splitHead(raw);
  const h = headers(head);
  const t = textOf(h, body);
  return { from: decodeWords(h.from ?? ''), to: decodeWords(h.to ?? ''), subject: decodeWords(h.subject ?? '').trim(), text: (t.plain || t.html || '').slice(0, 20_000) };
}

/** OTP near an OTP-like word (4–8 digits). Never sent to the model. */
export function findOtp(subject: string, text: string): string | null {
  const s = `${subject}\n${text}`;
  const m = s.match(/(?:otp|one[\s-]?time(?:\s+password)?|verification\s+code|security\s+code|passcode|code)\D{0,60}?\b(\d{4,8})\b/i)
    ?? s.match(/\b(\d{4,8})\b\D{0,40}(?:is\s+your|is\s+the)\s+(?:otp|one[\s-]?time|verification|code)/i);
  return m?.[1] ?? null;
}

export function classify(m: ParsedMail): { kind: 'OTP' | 'INVITE' | 'OTHER'; marketplace: 'AMAZON' | 'FLIPKART' | null } {
  const from = m.from.toLowerCase();
  const marketplace = /amazon\.(in|com)|sellercentral/.test(from) ? 'AMAZON' : /flipkart/.test(from) ? 'FLIPKART' : null;
  const s = `${m.subject} ${m.text.slice(0, 2000)}`;
  if (/invit|added you as a user|add(ed)? you to|user permission|join .*seller/i.test(s) && !findOtp(m.subject, m.text)) return { kind: 'INVITE', marketplace };
  if (findOtp(m.subject, m.text)) return { kind: 'OTP', marketplace };
  return { kind: 'OTHER', marketplace };
}
