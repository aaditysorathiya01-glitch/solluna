import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { config } from './config';

/**
 * Data-at-rest encryption (AES-256-GCM) for secrets such as TOTP seeds.
 * Key: DATA_ENCRYPTION_KEY (32+ chars), falling back to a key derived from JWT_SECRET for local dev.
 * Format: v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
const key = () => createHash('sha256').update(`solluna-data-key:${config.dataEncryptionKey}`).digest();

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(blob: string): string {
  const [v, iv, tag, ct] = blob.split(':');
  if (v !== 'v1') throw new Error('Unsupported ciphertext version');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

// ───────── TOTP (RFC 6238, SHA-1, 30 s, 6 digits — what Google Authenticator / Authy expect) ─────────

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totp(secretB32: string, at = Date.now(), step = 30): string {
  const counter = Math.floor(at / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}

/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secretB32: string, code: string, at = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((w) => {
    const expected = Buffer.from(totp(secretB32, at + w * 30_000));
    return timingSafeEqual(expected, Buffer.from(code));
  });
}

export const newTotpSecret = () => base32Encode(randomBytes(20));
