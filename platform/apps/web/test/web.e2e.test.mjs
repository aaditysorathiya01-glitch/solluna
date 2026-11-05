// Browser E2E: Next.js production build + real NestJS API + real Postgres, driven by Playwright/Chromium.
// Only Razorpay's hosted Checkout widget (third-party popup) is replaced: the stub returns a payment
// response signed exactly as Razorpay signs it, so our handler, /billing/verify and activation run for real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..');
const platformDir = join(webDir, '..', '..');
const apiDir = join(platformDir, 'apps', 'api');
const require = createRequire(join(platformDir, 'package.json'));
const { chromium } = require('playwright');

const SHOTS = process.env.SHOT_DIR ?? join(webDir, 'test', 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const PG = process.env.TEST_PG_ADMIN_URL ?? 'postgresql://postgres@localhost:5432/postgres';
const DB = 'solluna_web_e2e';
const DATABASE_URL = `postgresql://solluna:solluna@localhost:5432/${DB}`;
const KEY_ID = 'rzp_test_web', KEY_SECRET = 'web_key_secret';
const ADMIN = { email: 'admin@solluna.test', password: 'Admin-Passw0rd-123' };

let apiProc, webProc, rzp, browser, apiBase, webBase;
const procs = [];

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
async function waitFor(url, label, logs) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not start:\n${logs()}`);
}
function start(cmd, args, cwd, env) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  procs.push(p);
  return { p, logs: () => log };
}

before(async () => {
  execSync(`psql "${PG}" -c "DROP DATABASE IF EXISTS ${DB}" -c "CREATE DATABASE ${DB} OWNER solluna"`, { stdio: 'pipe' });
  execSync('npx prisma migrate deploy --schema apps/api/prisma/schema.prisma', { cwd: platformDir, env: { ...process.env, DATABASE_URL }, stdio: 'pipe' });
  execSync('npx tsx apps/api/prisma/seed-plans.ts', { cwd: platformDir, env: { ...process.env, DATABASE_URL, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, stdio: 'pipe' });

  rzp = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const o = JSON.parse(b);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: `order_web_${Date.now()}`, amount: o.amount, currency: o.currency, receipt: o.receipt, status: 'created' }));
    });
  });
  const rzpPort = await listen(rzp);
  const apiPort = 4800 + Math.floor(Math.random() * 100), webPort = 3800 + Math.floor(Math.random() * 100);
  apiBase = `http://127.0.0.1:${apiPort}/api`; webBase = `http://127.0.0.1:${webPort}`;

  const a = start('node', ['dist/apps/api/src/main.js'], apiDir, {
    DATABASE_URL, PORT: String(apiPort), JWT_SECRET: 'web-e2e-secret-web-e2e-secret-123', COOKIE_SECURE: 'false',
    RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: 'wh', RAZORPAY_API_BASE: `http://127.0.0.1:${rzpPort}`, RATE_LIMIT_PER_MIN: '10000', AUTH_RATE_LIMIT_PER_MIN: '100',
    SUPPLIER_LEGAL_NAME: 'SOLLUNA Marketplace Services', SUPPLIER_GSTIN: '24AAJCS1234M1ZA', SUPPLIER_ADDRESS: 'B-220 Supath-2 Complex, Ahmedabad, Gujarat 380013', SUPPLIER_EMAIL: 'solluna.play@gmail.com',
  });
  apiProc = a.p;
  await waitFor(`${apiBase}/health`, 'API', a.logs);
  const w = start('npx', ['next', 'start', '-p', String(webPort), '-H', '127.0.0.1'], webDir, { API_URL: `http://127.0.0.1:${apiPort}` });
  webProc = w.p;
  await waitFor(webBase, 'Web', w.logs);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch {} } // whole group: npx → next-server
  rzp?.close();
});

async function newPage(viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Stand-in for Razorpay's hosted Checkout popup.
  await page.exposeFunction('__sign', (orderId, paymentId) => createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex'));
  await page.addInitScript(() => {
    window.Razorpay = class {
      constructor(o) { this.o = o; window.__rzpOptions = o; }
      on() {}
      async open() {
        const pid = 'pay_' + this.o.order_id;
        this.o.handler({ razorpay_order_id: this.o.order_id, razorpay_payment_id: pid, razorpay_signature: await window.__sign(this.o.order_id, pid) });
      }
    };
  });
  return { page, errors, ctx };
}
async function apiCall(method, path, token, body) {
  const r = await fetch(apiBase + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

const S = {};

test('landing page renders live plans and the 28-service comparison', async () => {
  const { page, errors } = await newPage();
  await page.goto(webBase);
  await page.getByRole('heading', { name: /run by specialists/i }).waitFor();
  for (const price of ['₹1,999', '₹4,999', '₹9,999']) assert.ok(await page.getByText(price).first().isVisible(), price);
  assert.ok(await page.getByText('/month + GST').first().isVisible(), 'prices shown GST-exclusive');
  const serviceRows = await page.locator('#pricing tbody tr').count();
  assert.equal(serviceRows, 28 + 5, '28 services + 5 section headers');
  assert.ok(await page.getByText('On request').isVisible());
  await page.screenshot({ path: join(SHOTS, '1-landing.png'), fullPage: true });
  assert.deepEqual(errors, []);
});

test('landing page has no horizontal scroll on a phone', async () => {
  const { page } = await newPage({ width: 390, height: 844 });
  await page.goto(webBase);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
});

test('register → billing details → GST total → Razorpay checkout → verified → GST tax invoice', async () => {
  const { page, errors } = await newPage();
  S.customer = page;
  await page.goto(`${webBase}/register?plan=GROWTH`);
  await page.getByText('You chose the').waitFor();
  // Validation from the API surfaces on the form.
  await page.fill('#name', 'Riya Shah'); await page.fill('#email', 'riya@brand.test'); await page.fill('#phone', '12345');
  await page.fill('#legalName', 'Riya Lifestyle Pvt Ltd'); await page.fill('#password', 'Riya-Strong-Pass1');
  await page.click('button:has-text("Create account")');
  await page.getByText('Enter a valid Indian mobile number').waitFor();
  await page.fill('#phone', '9812345678');
  await page.click('button:has-text("Create account")');
  await page.waitForURL(/\/dashboard\?tab=billing&plan=GROWTH/);
  await page.getByRole('heading', { name: 'Billing', exact: true }).waitFor();
  const firstStates = await page.locator('#stateCode option').evaluateAll((o) => o.slice(1, 3).map((x) => x.textContent));
  assert.deepEqual(firstStates, ['01 · Jammu and Kashmir', '02 · Himachal Pradesh'], 'states listed in GST code order');

  assert.ok(await page.locator('button:has-text("Choose Growth")').isDisabled(), 'checkout needs billing details first');
  await page.fill('#gstin', '24ABCDE1234F1Z5');
  await page.fill('#address', '7 Linking Road, Bandra West'); await page.fill('#city', 'Mumbai'); await page.fill('#pincode', '400050');
  await page.click('button:has-text("Save billing details")');
  await page.getByRole('alert').getByText(/GSTIN/).waitFor(); // wrong check digit rejected by the API
  await page.fill('#gstin', '');
  await page.selectOption('#stateCode', '27');
  await page.click('button:has-text("Save billing details")');
  await page.getByText('Billing details saved.').waitFor();
  await page.getByText('Unregistered (no GSTIN)').waitFor();
  assert.equal((await page.getByTestId('total-GROWTH').innerText()).replace(/\s+/g, ' '), 'Payable ₹5,898.82 incl. IGST 18%');

  await page.click('button:has-text("Choose Growth")');
  await page.getByText('Payment verified. Your Growth plan is active.').waitFor();
  const opts = await page.evaluate(() => ({ amount: window.__rzpOptions.amount, key: window.__rzpOptions.key, currency: window.__rzpOptions.currency }));
  assert.deepEqual(opts, { amount: 589882, key: KEY_ID, currency: 'INR' }, 'Razorpay charged ₹4,999 + 18% IGST');

  await page.click('text=View tax invoice');
  await page.waitForURL(/\/invoices\//);
  const invoice = page.getByRole('article', { name: 'Tax invoice' });
  await invoice.getByText('SOL/26-27/00001').waitFor();
  for (const t of ['Tax Invoice', '24AAJCS1234M1ZA', 'Maharashtra (27)', 'IGST @ 18%', '₹5,898.82', 'Rupees Five Thousand Eight Hundred Ninety Eight and Eighty Two Paise Only', 'Unregistered recipient', '998399']) {
    assert.ok(await invoice.getByText(t, { exact: false }).first().isVisible(), `invoice shows ${t}`);
  }
  assert.equal(await invoice.getByText('CGST', { exact: false }).count(), 0, 'inter-state invoice has no CGST/SGST');
  await page.screenshot({ path: join(SHOTS, '5-tax-invoice.png'), fullPage: true });
  await page.goBack();

  await page.click('nav[aria-label="Dashboard"] >> text=overview');
  await page.getByText('Renews').waitFor();
  assert.ok(await page.getByText('20 / 28').isVisible(), 'Growth includes 20 of 28 services');
  assert.deepEqual(errors, []);
});

test('customer raises an Ads request; out-of-plan services are visibly not included', async () => {
  const page = S.customer;
  await page.click('nav[aria-label="Dashboard"] >> text=services');
  const premiumCard = page.locator('.card', { hasText: 'Product Research & Suggestions' });
  assert.ok(await premiumCard.getByText('Not in plan').isVisible());
  const ads = page.locator('.card', { hasText: 'Ads Management' }).first();
  assert.ok(await ads.getByText('Included').isVisible());
  await ads.getByRole('button', { name: 'Request' }).click();
  await page.fill('#title', 'Launch Sponsored Products for jute rugs');
  await page.selectOption('#marketplace', 'AMAZON');
  await page.fill('#notes', 'Focus on 3 hero SKUs, target ACOS under 30%');
  await page.click('button:has-text("Submit request")');
  await page.getByText('Request received. Your manager has been notified.').waitFor();
  await page.click('text=Launch Sponsored Products for jute rugs');
  await page.getByText('Review eligibility, prepare campaign structure, budget and targeting').waitFor();
  await page.getByText('**Request:**', { exact: false }).count(); // raw markdown must not leak
  assert.equal(await page.getByText('**', { exact: false }).count(), 0);
  await page.screenshot({ path: join(SHOTS, '2-dashboard-request.png'), fullPage: true });
});

test('staff executes the task in Ops with the skill procedure; client approves the budget', async () => {
  const admin = (await apiCall('POST', '/auth/login', null, ADMIN)).token;
  await apiCall('POST', '/admin/users/staff', admin, { name: 'Kabir Ads', email: 'kabir@solluna.test', password: 'Kabir-Passw0rd-1', staffRole: 'ADS_MANAGER' });

  const { page, errors } = await newPage();
  await page.goto(`${webBase}/login`);
  await page.fill('#email', 'kabir@solluna.test'); await page.fill('#password', 'Kabir-Passw0rd-1');
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/ops/);
  await page.click('text=Review eligibility, prepare campaign structure');
  await page.getByText('ads-management', { exact: true }).waitFor();
  await page.click('button:has-text("Show procedure")');
  await page.getByText('Break-even and profitability guardrails').first().waitFor();
  await page.screenshot({ path: join(SHOTS, '3-ops-task.png'), fullPage: true });

  await page.getByRole('button', { name: 'in progress', exact: true }).click();
  await page.click('button:has-text("Confirm: in progress")');
  await page.locator('.chip', { hasText: 'In progress' }).first().waitFor();

  await page.getByRole('button', { name: 'completed', exact: true }).click();
  await page.fill('#summary', 'Audit done; 3 campaigns planned, break-even ACOS 31%');
  await page.fill('#outputUrl', 'https://example.com/plan');
  await page.fill('#approvalParameters', '{"dailyBudgetInr": 750, "campaigns": 3, "durationDays": 30}');
  await page.click('button:has-text("Confirm: completed")');
  await page.getByRole('alert').getByText('approved delivery channel').waitFor(); // backend rejects non-Drive links
  await page.fill('#outputUrl', 'https://docs.google.com/spreadsheets/d/ads-plan');
  await page.click('button:has-text("Confirm: completed")');
  await page.locator('.chip', { hasText: 'Completed' }).first().waitFor();
  assert.deepEqual(errors, []);
  S.staff = page;

  const c = S.customer;
  await c.reload();
  await c.click('nav[aria-label="Dashboard"] >> text=approvals');
  await c.getByText('dailyBudgetInr').waitFor();
  assert.ok(await c.getByText('750').isVisible());
  await c.screenshot({ path: join(SHOTS, '4-approval.png'), fullPage: true });
  await c.click('button:has-text("Approve")');
  await c.getByText('Approved. Your manager has been notified.').waitFor();

  await page.click('button:has-text("Refresh")');
  await page.click('text=Launch campaigns as approved');
  await page.locator('.chip', { hasText: 'Queued' }).first().waitFor();
});

test('route guards: signed-out users go to login; customers cannot open ops', async () => {
  const { page } = await newPage();
  await page.goto(`${webBase}/dashboard`);
  await page.waitForURL(/\/login/);
  await S.customer.goto(`${webBase}/ops`);
  await S.customer.waitForURL(/\/dashboard/);
});
