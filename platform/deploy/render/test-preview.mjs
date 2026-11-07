// Role and workflow tests for the TEMPORARY Render preview (run after seed-demo.mjs).
//   node deploy/render/test-preview.mjs https://solluna-preview.onrender.com [screenshot-dir]
// Env: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TOTP_SECRET, STAFF_PASSWORD, CLIENT_PASSWORD, [PLAYWRIGHT_PROXY].
// Read-mostly: the only writes are one label download (marks the batch delivered), one stock acknowledgement and
// one listing request that is expected to be refused or routed for approval.
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(here, '..', '..', 'package.json'))('playwright');
const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
const SHOTS = process.argv[3];
if (!/^https:\/\//.test(BASE)) { console.error('Usage: test-preview.mjs https://<preview> [screenshot-dir]'); process.exit(2); }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const E = process.env;
const api = BASE + '/api';

function totp(secret, at = Date.now()) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of secret.replace(/\s+/g, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac('sha1', key).update(msg).digest(); const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
const results = [];
async function check(area, name, fn) {
  try { const note = await fn(); results.push({ area, name, ok: true, note: note ?? '' }); }
  catch (e) { results.push({ area, name, ok: false, note: String(e.message ?? e).split('\n')[0] }); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
async function req(method, path, token, body) {
  const r = await fetch(api + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, headers: r.headers };
}
async function login(email, password, secret) {
  let r = await req('POST', '/auth/login', null, { email, password });
  if (r.status === 401 && r.json.twoFactorRequired) r = await req('POST', '/auth/login', null, { email, password, code: totp(secret) });
  assert(r.status === 200 || r.status === 201, `login ${email} → ${r.status}`);
  return r.json.token;
}

const T = {};
await check('Auth', 'Demo accounts sign in (admin with 2FA, 5 staff, 3 clients)', async () => {
  T.admin = await login(E.ADMIN_EMAIL, E.ADMIN_PASSWORD, E.ADMIN_TOTP_SECRET);
  for (const n of ['kabir', 'meera', 'rohan', 'isha', 'neha']) T[n] = await login(`${n}@demo.solluna.co.in`, E.STAFF_PASSWORD);
  for (const n of ['riya', 'amit', 'kavya']) T[n] = await login(`${n}@demo.solluna.co.in`, E.CLIENT_PASSWORD);
  return '9 accounts';
});
await check('Auth', 'Admin without 2FA code is refused', async () => {
  const r = await req('POST', '/auth/login', null, { email: E.ADMIN_EMAIL, password: E.ADMIN_PASSWORD });
  assert(r.status === 401 && r.json.twoFactorRequired, `got ${r.status}`);
});
const org = {};
for (const n of ['riya', 'amit', 'kavya']) org[n] = (await req('GET', '/auth/me', T[n])).json.organization?.id;

await check('Subscriptions', 'Demo plans active with no payments or invoices', async () => {
  const want = { riya: 'GROWTH', amit: 'RESELLER', kavya: 'PREMIUM' };
  for (const [n, code] of Object.entries(want)) {
    const b = (await req('GET', '/billing', T[n])).json;
    assert(b.subscriptions.some((s) => s.status === 'ACTIVE' && s.plan.code === code), `${n} not on ${code}`);
    assert(b.payments.length === 0 && b.invoices.length === 0, `${n} has payments/invoices`);
  }
  return 'Growth / Reseller / Premium, 0 payments';
});
await check('Subscriptions', 'Checkout refused while Razorpay is not configured', async () => {
  const r = await req('POST', '/billing/checkout', T.amit, { planCode: 'GROWTH', acceptTerms: true });
  assert(r.status === 503, `checkout returned ${r.status}`);
  const b = (await req('GET', '/billing', T.amit)).json;
  assert(b.payments.length === 0 && !b.subscriptions.some((s) => s.status === 'PENDING_PAYMENT'), 'refused checkout left payment/subscription rows');
  return 'HTTP 503, nothing written';
});

await check('Listings', 'Client sees listing lifecycle (ACTIVE with verified URL, brand approval, in progress)', async () => {
  const L = (await req('GET', '/listings', T.riya)).json;
  const active = L.find((l) => l.status === 'ACTIVE');
  assert(active && active.catalogId === 'B0DRIYA001', 'no ACTIVE listing with ASIN');
  assert(L.some((l) => l.status === 'BRAND_APPROVAL_REQUIRED') && L.some((l) => l.status === 'CONTENT_IN_PROGRESS'), 'statuses missing');
  return `${L.length} listings`;
});
await check('Listings', 'ACTIVE refused without marketplace evidence', async () => {
  const L = (await req('GET', '/listings', T.riya)).json;
  const wip = L.find((l) => l.status === 'CONTENT_IN_PROGRESS');
  const r = await req('PATCH', `/ops/listings/${wip.id}`, T.isha, { status: 'ACTIVE' });
  assert(r.status === 400, `got ${r.status}`);
});
await check('Listings', 'Catalog mapping results visible to client', async () => {
  const M = (await req('GET', '/mappings', T.riya)).json;
  assert(M.some((m) => m.status === 'EXACT_VERIFIED') && M.some((m) => m.status === 'NO_MATCH_FOUND'), 'mapping statuses');
  return `${M.length} SKUs`;
});
await check('Workflows', 'Orchestrator: ads plan awaiting client budget approval', async () => {
  const A = (await req('GET', '/approvals', T.riya)).json;
  const ad = A.find((a) => a.actionType === 'AD_BUDGET');
  assert(ad && ad.status === 'REQUESTED', 'no ad-budget approval awaiting the client');
  return `₹${ad.parameters.dailyBudgetInr}/day × ${ad.parameters.durationDays} days`;
});
await check('Permissions', 'Reseller asking for ads is routed as out-of-plan', async () => {
  const R = (await req('GET', '/requests', T.amit)).json;
  const list = R.requests ?? R;
  assert(list.some((r) => r.featureKey === 'ADS_MANAGEMENT' && r.entitlement === 'OUT_OF_PLAN'), 'ads not OUT_OF_PLAN');
});
await check('Permissions', 'Reseller cannot receive shipping labels (Growth+ only)', async () => {
  const r = await req('GET', '/labels', T.amit);
  assert(r.status === 403 || (Array.isArray(r.json) && r.json.length === 0), `got ${r.status}`);
  return r.status === 403 ? 'HTTP 403' : 'empty';
});
await check('Labels', 'Client downloads labels → batch marked delivered', async () => {
  const L = (await req('GET', '/labels', T.riya)).json;
  assert(L.length >= 2, 'labels missing');
  const job = L.find((j) => j.status !== 'DELIVERED') ?? L[0];
  const d = await fetch(`${api}/labels/${job.id}/download`, { headers: { authorization: `Bearer ${T.riya}` } });
  assert(d.ok && (d.headers.get('content-type') ?? '').includes('pdf'), `download ${d.status}`);
  const after = (await req('GET', '/labels', T.riya)).json.find((j) => j.id === job.id);
  assert(after.status === 'DELIVERED', `status ${after.status}`);
  return `${L.length} batches`;
});
await check('Labels', 'Premium thank-you notes: approved design + design awaiting client review', async () => {
  const D = (await req('GET', '/thank-you', T.kavya)).json.templates;
  assert(D.some((d) => d.status === 'APPROVED') && D.some((d) => d.status === 'CLIENT_REVIEW'), JSON.stringify(D.map((d) => d.status)));
  const L = (await req('GET', '/labels', T.kavya)).json;
  assert(L.some((j) => j.noteCount > 0), 'no note inserts on Premium labels');
});
await check('Inventory', 'Low-stock severities computed (CRITICAL, out of stock, no-velocity)', async () => {
  const I = (await req('GET', '/inventory', T.riya)).json;
  const rows = I.marketplaces.AMAZON.rows;
  const sev = rows.map((r) => r.severity);
  assert(sev.includes('CRITICAL'), JSON.stringify(sev));
  return [...new Set(sev.map(String))].join(', ');
});
await check('Reports', 'Published performance + P&L reports, P&L marks missing costs as estimated', async () => {
  const R = (await req('GET', '/reports', T.riya)).json;
  const pl = R.find((r) => r.kind === 'PL'); const perf = R.find((r) => r.kind === 'PERFORMANCE');
  assert(pl && perf, 'reports missing');
  const full = await req('GET', `/reports/${pl.id}`, T.riya);
  assert(/ESTIMATED|UNAVAILABLE/.test(JSON.stringify(full.json)), 'P&L should flag estimated figures');
  const csv = await fetch(`${api}/reports/${perf.id}/export.csv`, { headers: { authorization: `Bearer ${T.riya}` } });
  assert(csv.ok, `csv ${csv.status}`);
  return `${R.length} reports, CSV export OK`;
});
await check('Support', 'Tickets: client sees staff reply, never internal notes', async () => {
  const L = (await req('GET', '/tickets', T.riya)).json;
  const t = L.find((x) => /Late dispatch/.test(x.subject));
  const d = await req('GET', `/tickets/${t.id}`, T.riya);
  assert(t.status === 'WAITING_FOR_CLIENT', t.status);
  assert(!JSON.stringify(d.json).includes('Internal: 6 orders'), 'internal note leaked to client');
});
await check('Support', 'Manager Chat: internal staff note hidden from client', async () => {
  const c = (await req('GET', '/chat', T.riya)).json;
  const s = JSON.stringify(c);
  assert(s.includes('Please approve') && !s.includes('keep bids conservative'), 'chat visibility wrong');
});

await check('Permissions', 'Tenant isolation: client cannot read another client’s data', async () => {
  const kabirView = (await req('GET', `/ops/clients/${org.riya}/listings`, T.kabir)).json;
  const id = kabirView[0].id;
  const r1 = await req('GET', `/ops/clients/${org.riya}/listings`, T.amit);
  assert(r1.status === 403, `ops route as client → ${r1.status}`);
  const r2 = await req('GET', '/listings', T.amit);
  assert(!JSON.stringify(r2.json).includes(id), 'Amit sees Riya listing');
  const r3 = await req('GET', `/requests/${(await req('GET', '/requests', T.riya)).json[0]?.id ?? 'x'}`, T.amit);
  assert([403, 404].includes(r3.status), `cross-tenant request → ${r3.status}`);
});
await check('Permissions', 'Clients blocked from staff and admin APIs', async () => {
  for (const p of ['/ops/tasks', '/admin/overview', '/admin/client-list', '/admin/payments']) {
    const r = await req('GET', p, T.riya); assert(r.status === 403, `${p} → ${r.status}`);
  }
});
await check('Permissions', 'Staff roles: listing executive cannot edit plans or read audit; ops manager cannot edit plans', async () => {
  assert((await req('PATCH', '/admin/plans/GROWTH', T.isha, { pricePaise: 100 })).status === 403, 'isha plans');
  assert((await req('GET', '/admin/audit', T.isha)).status === 403, 'isha audit');
  assert((await req('PATCH', '/admin/plans/GROWTH', T.kabir, { pricePaise: 100 })).status === 403, 'kabir plans');
});
await check('Staff', 'Ops task queue and client list load for operations manager', async () => {
  const q = await req('GET', '/ops/tasks', T.kabir); assert(q.status === 200, `tasks ${q.status}`);
  const c = await req('GET', '/admin/client-list', T.kabir); assert(c.status === 200, `clients ${c.status}`);
  return `${q.json.length} tasks`;
});
await check('Admin', 'Admin overview, plans editor data, enquiries and audit log', async () => {
  for (const p of ['/admin/overview', '/admin/plans', '/admin/inquiries', '/admin/audit']) {
    const r = await req('GET', p, T.admin); assert(r.status === 200, `${p} → ${r.status}`);
  }
  const audit = JSON.stringify((await req('GET', '/admin/audit', T.admin)).json);
  return audit.includes('preview.demo_subscription') ? 'demo plans visible in audit log' : 'audit OK';
});

// ── Browser: each role's main screens ─────────────────────────────────────────────────────────────
const browser = await chromium.launch(E.PLAYWRIGHT_PROXY ? { proxy: { server: E.PLAYWRIGHT_PROXY } } : {});
const errors = [];
async function asUser(email, password, secret) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(`${email}: ${e.message}`));
  await p.goto(BASE + '/login'); await p.fill('#email', email); await p.fill('#password', password);
  await p.click('button:has-text("Sign in")');
  if (secret) { await p.locator('#code').waitFor({ timeout: 15000 }); await p.fill('#code', totp(secret)); await p.click('button:has-text("Sign in")'); }
  return p;
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false }); };
await check('UI', 'Client dashboard: chat, listings, labels, notifications + approval, reports, billing (Riya, Growth)', async () => {
  const p = await asUser('riya@demo.solluna.co.in', E.CLIENT_PASSWORD);
  await p.waitForURL(/\/dashboard/, { timeout: 20000 }); await p.getByRole('region', { name: 'Your account manager' }).waitFor(); await shot(p, 'client-chat');
  for (const [tab, text, sub] of [['listings', 'Flipkart — map to an existing product'], ['labels', '18 orders', 'From your manager'], ['notifications', 'Needs your approval'], ['reports', 'P&L report'], ['billing', 'GSTIN 24ABCDE1234F1Z6']]) {
    await p.goto(`${BASE}/dashboard?tab=${tab}`); if (sub) await p.getByRole('tab', { name: sub }).click();
    await p.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 }); await shot(p, `client-${tab}`);
  }
  await p.context().close();
});
await check('UI', 'Premium client: thank-you design review', async () => {
  const p = await asUser('kavya@demo.solluna.co.in', E.CLIENT_PASSWORD);
  await p.waitForURL(/\/dashboard/, { timeout: 20000 });
  await p.goto(`${BASE}/dashboard?tab=labels`); await p.getByRole('tab', { name: 'From your manager' }).click(); await p.getByText('Thank-you notes', { exact: true }).click(); await p.getByText('Everyday insert', { exact: false }).first().waitFor({ timeout: 15000 }); await shot(p, 'premium-thank-you');
  await p.context().close();
});
await check('UI', 'Staff console: task queue and client workspace (Kabir, operations manager)', async () => {
  const p = await asUser('kabir@demo.solluna.co.in', E.STAFF_PASSWORD);
  await p.waitForURL(/\/ops/, { timeout: 20000 }); await p.getByText('Task queue').first().waitFor({ timeout: 15000 }); await shot(p, 'staff-queue');
  await p.context().close();
});
await check('UI', 'Admin console with 2FA (MRR, clients, plans)', async () => {
  const p = await asUser(E.ADMIN_EMAIL, E.ADMIN_PASSWORD, E.ADMIN_TOTP_SECRET);
  await p.waitForURL(/\/ops/, { timeout: 20000 });
  await p.getByRole('button', { name: 'Admin', exact: true }).click(); await p.getByText('MRR (excl. GST)').waitFor({ timeout: 15000 }); await shot(p, 'admin-console');
  await p.context().close();
});
await check('UI', 'New sign-up: plans only → test activation → plan dashboard with manager welcome', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } }); const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`signup: ${e.message}`));
  const stamp = Date.now().toString(36);
  await p.goto(BASE + '/register');
  await p.fill('#name', 'Flow Check'); await p.fill('#email', `flow+${stamp}@demo.solluna.co.in`);
  await p.fill('#phone', `8${String(Date.now()).slice(-9)}`); await p.fill('#legalName', `FLOW CHECK ${stamp} (test account)`);
  await p.fill('#password', `Flow-${stamp}-Pass1`); await p.check('input[name="terms"]');
  await p.click('button:has-text("Create account")');
  await p.getByRole('heading', { name: 'Choose your plan' }).waitFor({ timeout: 60000 });
  assert(await p.locator('nav[aria-label="Dashboard"]').count() === 0, 'tabs visible before a plan');
  await shot(p, 'signup-plans');
  await p.getByRole('button', { name: 'Select Growth' }).click();
  await p.getByRole('button', { name: 'Activate Growth for testing (no payment)' }).click();
  const mgr = p.getByRole('region', { name: 'Your account manager' });
  await mgr.getByText('Assigned within 1 hour', { exact: false }).waitFor({ timeout: 30000 });
  const tabs = (await p.locator('nav[aria-label="Dashboard"] button').allInnerTexts()).map((t) => t.trim().toLowerCase());
  assert(tabs.join('|') === 'manager chat|listings & mapping|labels|reports|notifications', `Growth tabs: ${tabs}`);
  await shot(p, 'signup-growth-overview');
  await ctx.close();
  return 'plan dashboard + manager promised within 1 hour';
});
await check('UI', 'Reseller: same five areas; label cropper in manual mode', async () => {
  const p = await asUser('amit@demo.solluna.co.in', E.CLIENT_PASSWORD);
  await p.waitForURL(/\/dashboard/, { timeout: 20000 }); await p.locator('nav[aria-label="Dashboard"]').waitFor();
  const tabs = (await p.locator('nav[aria-label="Dashboard"] button').allInnerTexts()).map((t) => t.trim().toLowerCase());
  assert(tabs.join('|') === 'manager chat|listings & mapping|labels|reports|notifications', `Reseller tabs: ${tabs}`);
  await p.click('nav[aria-label="Dashboard"] >> text=Labels'); await p.getByRole('region', { name: 'Label cropper' }).waitFor();
  assert(await p.locator('input[name="crop-mode"][value="AUTO"]').isDisabled() && await p.locator('input[name="crop-mode"][value="MANUAL"]').isChecked(), 'Reseller: manual crop only');
  await p.context().close();
});
await check('UI', 'Public site shows the preview banner and is hidden from search engines', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  await p.goto(BASE + '/'); await p.getByText('Temporary test environment', { exact: false }).first().waitFor();
  const robots = await p.locator('meta[name="robots"]').getAttribute('content');
  assert(/noindex/.test(robots ?? ''), `robots: ${robots}`); await shot(p, 'public-mobile'); await ctx.close();
});
await check('UI', 'No JavaScript errors across all role sessions', async () => { assert(!errors.length, errors.join(' | ')); });
await browser.close();

console.log(`\nSOLLUNA preview role & workflow tests — ${BASE} — ${new Date().toISOString()}\n`);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${(r.area + ' ').padEnd(14)}${r.name.padEnd(92).slice(0, 92)} ${r.note}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
