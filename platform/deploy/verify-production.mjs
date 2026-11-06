// Post-deployment verification for SOLLUNA 2.0, run with real Chromium against a deployed URL.
//   node platform/deploy/verify-production.mjs https://solluna.co.in            # read-only checks
//   node platform/deploy/verify-production.mjs https://solluna.co.in --write    # + creates one clearly-labelled test client
// Optional admin check (needs the admin's TOTP secret; never stored): ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TOTP_SECRET.
// --insecure only for local stacks with a self-signed certificate.
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', 'package.json'));
const { chromium } = require('playwright');

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
const WRITE = process.argv.includes('--write');
const INSECURE = process.argv.includes('--insecure');
if (!/^https:\/\//.test(BASE)) { console.error('Usage: verify-production.mjs https://<domain> [--write] [--insecure]'); process.exit(2); }

const results = [];
async function check(name, fn) {
  const t = Date.now();
  try { const note = await fn(); results.push({ name, ok: true, note: note ?? '', ms: Date.now() - t }); }
  catch (e) { results.push({ name, ok: false, note: String(e.message ?? e).split('\n')[0], ms: Date.now() - t }); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
function totp(secret, at = Date.now()) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of secret.replace(/\s+/g, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac('sha1', key).update(msg).digest(); const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

// PLAYWRIGHT_PROXY: optional outbound proxy (e.g. a sandbox that only reaches the internet through one).
const browser = await chromium.launch(process.env.PLAYWRIGHT_PROXY ? { proxy: { server: process.env.PLAYWRIGHT_PROXY } } : {});
const ctx = await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const req = ctx.request;

await check('TLS certificate valid + HTTPS served', async () => {
  const r = await req.get(BASE + '/');
  assert(r.status() === 200, `HTTP ${r.status()}`);
  return INSECURE ? 'self-signed accepted (--insecure)' : 'certificate verified by Chromium';
});
await check('HTTP redirects to HTTPS', async () => {
  const r = await req.get(BASE.replace('https://', 'http://') + '/', { maxRedirects: 0 });
  assert([301, 308].includes(r.status()), `HTTP ${r.status()}`);
  assert((r.headers().location ?? '').startsWith('https://'), 'redirect target not https');
});
await check('Security headers (HSTS, nosniff, frame deny)', async () => {
  const h = (await req.get(BASE + '/')).headers();
  assert(h['strict-transport-security'], 'missing HSTS'); assert(h['x-content-type-options'] === 'nosniff', 'nosniff'); assert(h['x-frame-options'], 'x-frame-options');
});
await check('Backend health (API + DB + 29 skills)', async () => {
  const j = await (await req.get(BASE + '/api/health')).json();
  assert(j.ok && j.skillsLoaded === 29, JSON.stringify(j));
  return `payments: ${j.payments}, email connector: ${j.connectorWebhook}`;
});
await check('Plans from database, GST-exclusive', async () => {
  const plans = await (await req.get(BASE + '/api/plans')).json();
  const price = Object.fromEntries(plans.map((p) => [p.code, p.pricePaise]));
  assert(price.RESELLER === 199900 && price.GROWTH === 499900 && price.PREMIUM === 999900, JSON.stringify(price));
  assert(plans.every((p) => p.features.length === 28), 'features');
  return '₹1,999 / ₹4,999 / ₹9,999 + GST';
});
for (const [path, text] of [['/', 'run by specialists'], ['/services', '28 services'], ['/about', 'Specialists for the work'], ['/faq', 'Questions sellers ask'], ['/contact', 'Tell us about your marketplace'], ['/terms', 'Terms & Conditions'], ['/privacy', 'Privacy Policy'], ['/refund-policy', 'Refund & Cancellation Policy'], ['/login', 'Sign in'], ['/register', 'Create your seller account'], ['/forgot-password', 'Reset your password']]) {
  await check(`Page ${path}`, async () => {
    const r = await page.goto(BASE + path, { waitUntil: 'networkidle' });
    assert(r.status() === 200, `HTTP ${r.status()}`);
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 10000 });
  });
}
await check('Home shows "+ GST" on every plan', async () => {
  await page.goto(BASE + '/');
  assert(await page.getByText('/month + GST').count() >= 3, 'GST-exclusive label missing');
});
await check('Mobile: no horizontal scroll (390 px)', async () => {
  const m = await browser.newContext({ ignoreHTTPSErrors: INSECURE, viewport: { width: 390, height: 844 } });
  const p = await m.newPage();
  for (const path of ['/', '/services', '/contact']) {
    await p.goto(BASE + path);
    const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(o <= 0, `${path} overflows by ${o}px`);
  }
  await m.close();
});
await check('Route guard: dashboard requires sign-in', async () => {
  const p = await ctx.newPage(); await p.goto(BASE + '/dashboard'); await p.waitForURL(/\/login/, { timeout: 10000 }); await p.close();
});
await check('API rejects unauthenticated + wrong password', async () => {
  assert((await req.get(BASE + '/api/auth/me')).status() === 401, 'me should be 401');
  assert((await req.post(BASE + '/api/auth/login', { data: { email: 'nobody@solluna.co.in', password: 'wrong-password' } })).status() === 401, 'login should be 401');
});

if (WRITE) {
  const stamp = Date.now().toString(36);
  const email = `deploy-check+${stamp}@solluna.co.in`;
  await check('Register test client (UI) → dashboard', async () => {
    await page.goto(BASE + '/register');
    await page.fill('#name', 'Deployment Check'); await page.fill('#email', email);
    await page.fill('#phone', `9${String(Date.now()).slice(-9)}`); await page.fill('#legalName', `DEPLOYMENT CHECK ${stamp} (test account)`);
    await page.fill('#password', `Check-${stamp}-Pass1`); await page.check('input[name="terms"]');
    await page.click('button:has-text("Create account")');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.getByText('Finish setting up').waitFor({ timeout: 15000 });
    return email;
  });
  await check('Session cookie is Secure + HttpOnly', async () => {
    const c = (await ctx.cookies()).find((x) => x.name === 'solluna_session');
    assert(c && c.secure && c.httpOnly, JSON.stringify(c));
  });
  await check('Billing: GST shown separately, checkout disabled while Razorpay is off', async () => {
    await page.goto(BASE + '/dashboard?tab=billing');
    await page.fill('#address', '1 Deployment Check Road'); await page.fill('#city', 'Anjar'); await page.fill('#pincode', '370110');
    await page.selectOption('#stateCode', '24');
    await page.click('button:has-text("Save billing details")');
    await page.getByText('CGST 9% + SGST 9%', { exact: false }).first().waitFor({ timeout: 10000 });
    const total = await page.getByTestId('total-RESELLER').innerText();
    assert(total.includes('₹2,358.82'), `Reseller payable shown as: ${total}`);
    const cfg = await page.getByText('Online payments are not configured', { exact: false }).count();
    if (cfg) assert(await page.getByRole('button', { name: 'Choose Reseller' }).isDisabled(), 'checkout button should be disabled');
    return cfg ? 'Razorpay off → buttons disabled, no simulated payment' : 'Razorpay configured';
  });
  await check('Dashboard tabs load (catalog, tickets, settings, documents, reports)', async () => {
    for (const t of ['catalog', 'tickets', 'settings', 'documents', 'reports', 'labels', 'inventory']) {
      await page.goto(`${BASE}/dashboard?tab=${t}`);
      await page.locator('main h1').first().waitFor({ timeout: 10000 });
    }
  });
  await check('Support ticket: create and list', async () => {
    await page.goto(BASE + '/dashboard?tab=tickets');
    await page.click('button:has-text("New ticket")');
    await page.fill('#t-sub', 'Deployment check ticket'); await page.fill('#t-desc', 'Automated post-deployment check. Safe to close.');
    await page.selectOption('#t-pri', 'P4');
    await page.click('button:has-text("Create ticket")');
    await page.getByText('Deployment check ticket').first().waitFor({ timeout: 10000 });
  });
  await check('Contact form → admin enquiry inbox', async () => {
    const r = await req.post(BASE + '/api/public/contact', { data: { name: 'Deployment Check', email, topic: 'GENERAL', message: `Automated post-deployment check ${stamp}. Please ignore.` } });
    assert(r.ok(), `HTTP ${r.status()}`);
  });
}

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && process.env.ADMIN_TOTP_SECRET) {
  await check('Admin sign-in with 2FA → admin console', async () => {
    const a = await (await browser.newContext({ ignoreHTTPSErrors: INSECURE })).newPage();
    await a.goto(BASE + '/login');
    await a.fill('#email', process.env.ADMIN_EMAIL); await a.fill('#password', process.env.ADMIN_PASSWORD);
    await a.click('button:has-text("Sign in")');
    await a.locator('#code').waitFor({ timeout: 10000 });
    await a.fill('#code', totp(process.env.ADMIN_TOTP_SECRET));
    await a.click('button:has-text("Sign in")');
    await a.waitForURL(/\/ops/, { timeout: 15000 });
    await a.getByRole('button', { name: 'Admin', exact: true }).click();
    await a.getByText('MRR (excl. GST)').waitFor({ timeout: 10000 });
  });
}

await check('No JavaScript errors in the browser', async () => { assert(!pageErrors.length, pageErrors.join(' | ')); });
await browser.close();

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log(`\nSOLLUNA deployment verification — ${BASE} — ${new Date().toISOString()}\n`);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${pad(r.name, 66)} ${r.note}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
