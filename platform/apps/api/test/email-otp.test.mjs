// Sign-in code by email (owner, 12 Nov 2026): a separate API process with direct email (Resend mock) and LOGIN_EMAIL_OTP=staff.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const platformDir = join(apiDir, '..', '..');
const PG = process.env.TEST_PG_ADMIN_URL ?? 'postgresql://postgres@localhost:5432/postgres';
const DB_NAME = 'solluna_e2e_otp';
const DATABASE_URL = `postgresql://solluna:solluna@localhost:5432/${DB_NAME}`;
const ADMIN = { email: 'owner@solluna.test', password: 'Admin-Passw0rd-123' };
const mails = [];
let api, base, resend;

before(async () => {
  execSync(`psql "${PG}" -c "DROP DATABASE IF EXISTS ${DB_NAME}" -c "CREATE DATABASE ${DB_NAME} OWNER solluna"`, { stdio: 'pipe' });
  execSync('npx prisma migrate deploy --schema apps/api/prisma/schema.prisma', { cwd: platformDir, env: { ...process.env, DATABASE_URL }, stdio: 'pipe' });
  execSync('npx tsx apps/api/prisma/seed-plans.ts', { cwd: platformDir, env: { ...process.env, DATABASE_URL, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, stdio: 'pipe' });
  resend = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      if (req.url !== '/emails' || req.headers.authorization !== 'Bearer re_test_key') { res.writeHead(401).end('{}'); return; }
      mails.push(JSON.parse(b));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: `m${mails.length}` }));
    });
  });
  await new Promise((r) => resend.listen(0, '127.0.0.1', r));
  const port = 5200 + Math.floor(Math.random() * 300);
  base = `http://127.0.0.1:${port}/api`;
  api = spawn('node', ['dist/apps/api/src/main.js'], {
    cwd: apiDir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL, PORT: String(port), JWT_SECRET: 'otp-e2e-secret-otp-e2e-secret-123', COOKIE_SECURE: 'false', RESEND_API_KEY: 're_test_key', RESEND_API_URL: `http://127.0.0.1:${resend.address().port}`, LOGIN_EMAIL_OTP: 'staff', PREVIEW_MODE: 'true', REPORT_CYCLE: 'off', RATE_LIMIT_PER_MIN: '10000', AUTH_RATE_LIMIT_PER_MIN: '100', MANAGER_ASSIGN_DELAY_MIN: '0' },
  });
  let log = ''; api.stdout.on('data', (d) => (log += d)); api.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
    if (i === 79) throw new Error('API did not start:\n' + log);
  }
});
after(() => { api?.kill(); resend?.close(); });

async function call(method, path, body, token) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const codeOf = (m) => m.subject.match(/^(\d{6}) is your SOLLUNA sign-in code$/)[1];

test('staff sign in with an emailed code: sent once a minute, hashed, 5 tries, one use; no authenticator enrolment; clients unchanged', async () => {
  const first = await call('POST', '/auth/login', ADMIN);
  assert.equal(first.status, 401); assert.equal(first.body.twoFactorRequired, true); assert.equal(first.body.method, 'email');
  assert.match(first.body.message, /emailed a 6-digit code to ow•+@solluna\.test/);
  assert.equal(mails.length, 1); assert.deepEqual(mails[0].to, [ADMIN.email]); assert.match(mails[0].from, /no-reply@solluna\.co\.in/);
  const code = codeOf(mails[0]);
  assert.ok(mails[0].text.includes(code));

  assert.equal((await call('POST', '/auth/login', ADMIN)).status, 401);
  assert.equal(mails.length, 1, 'no second email within a minute');
  const wrong = await call('POST', '/auth/login', { ...ADMIN, code: code === '000000' ? '111111' : '000000' });
  assert.equal(wrong.status, 401); assert.match(wrong.body.message, /did not match/);
  const okLogin = await call('POST', '/auth/login', { ...ADMIN, code });
  assert.equal(okLogin.status, 200, JSON.stringify(okLogin.body));
  const me = await call('GET', '/auth/me', null, okLogin.body.token);
  assert.equal(me.body.user.twoFactorRequired, false, 'no authenticator enrolment when codes come by email');
  assert.equal(me.body.user.loginCodeByEmail, true);
  assert.equal((await call('GET', '/admin/overview', null, okLogin.body.token)).status, 200, 'admin console opens');
  const reuse = await call('POST', '/auth/login', { ...ADMIN, code });
  assert.equal(reuse.status, 401); assert.match(reuse.body.message, /expired/, 'a code works once');

  // Five wrong tries burn the code.
  mails.length = 0;
  // Wait out the one-minute resend window by expiring the previous code is not needed: the used code no longer counts as live.
  assert.equal((await call('POST', '/auth/login', ADMIN)).status, 401);
  const code2 = codeOf(mails[0]);
  for (let i = 0; i < 5; i++) await call('POST', '/auth/login', { ...ADMIN, code: code2 === '222222' ? '333333' : '222222' });
  const burnt = await call('POST', '/auth/login', { ...ADMIN, code: code2 });
  assert.equal(burnt.status, 401); assert.match(burnt.body.message, /expired/);

  // Sign-up: a 6-digit code to the email first; the account exists only after the right code.
  mails.length = 0;
  const SIGNUP = { name: 'Otp Client', email: 'otp.client@seller.test', phone: '9876501234', password: 'Client-Passw0rd-1' };
  const start = await call('POST', '/auth/register', SIGNUP);
  assert.equal(start.status, 202, JSON.stringify(start.body)); assert.equal(start.body.codeRequired, true); assert.ok(!start.body.token);
  const scode = mails[0].subject.match(/^(\d{6}) is your SOLLUNA verification code$/)[1];
  assert.equal((await call('POST', '/auth/login', { email: SIGNUP.email, password: SIGNUP.password })).status, 401, 'no account before the code');
  assert.equal((await call('POST', '/auth/register', { ...SIGNUP, code: scode === '999999' ? '888888' : '999999' })).status, 400);
  const reg = await call('POST', '/auth/register', { ...SIGNUP, code: scode });
  assert.equal(reg.status, 201, JSON.stringify(reg.body)); assert.ok(reg.body.token);
  const cme = await call('GET', '/auth/me', null, reg.body.token);
  assert.equal(cme.body.user.emailVerified, true, 'email proven by the code');
  assert.equal(cme.body.organization?.legalName ?? 'Otp Client', 'Otp Client', 'business name defaults to the person');
  assert.equal(mails.length, 1, 'no separate verification-link email');
  // Clients (LOGIN_EMAIL_OTP=staff) sign in with the password only.
  assert.equal((await call('POST', '/auth/login', { email: 'otp.client@seller.test', password: 'Client-Passw0rd-1' })).status, 200);

  // Preview only: super admin deletes a test client and all of its data (email typed twice).
  mails.length = 0;
  await new Promise((r) => setTimeout(r, 61_000)); // one sign-in email per minute
  assert.equal((await call('POST', '/auth/login', ADMIN)).status, 401);
  const tok = (await call('POST', '/auth/login', { ...ADMIN, code: codeOf(mails[0]) })).body.token;
  assert.equal((await call('POST', '/admin/test-clients/delete', { email: 'otp.client@seller.test', confirm: 'other@seller.test' }, tok)).status, 400);
  const del = await call('POST', '/admin/test-clients/delete', { email: 'otp.client@seller.test', confirm: 'OTP.client@seller.test' }, tok);
  assert.equal(del.status, 200, JSON.stringify(del.body)); assert.ok(del.body.rows > 0);
  assert.equal((await call('POST', '/auth/login', { email: 'otp.client@seller.test', password: 'Client-Passw0rd-1' })).status, 401);
  const again = await call('POST', '/auth/register', { name: 'Otp Client', email: 'otp.client@seller.test', phone: '9876501234', password: 'Client-Passw0rd-1' });
  assert.equal(again.status, 202, 'email and phone are free again (a new sign-up code is sent)');
});
