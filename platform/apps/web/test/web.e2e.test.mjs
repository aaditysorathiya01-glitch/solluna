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
    SUPPLIER_LEGAL_NAME: 'Aaditya Jitendrabhai Sorathia', SUPPLIER_TRADE_NAME: 'Solluna', SUPPLIER_GSTIN: '24OPVPS8924H1ZQ', SUPPLIER_ADDRESS: 'Survey No 135, Plot No 9, Shreeji Nagar, Meghpar Kumbhardi Sim, Anjar, Kachchh, Gujarat 370110', SUPPLIER_EMAIL: 'solluna.play@gmail.com',
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
  for (const t of ['Tax Invoice', '24OPVPS8924H1ZQ', 'Aaditya Jitendrabhai Sorathia', 'PAN OPVPS8924H', 'Maharashtra (27)', 'IGST @ 18%', '₹5,898.82', 'Rupees Five Thousand Eight Hundred Ninety Eight and Eighty Two Paise Only', 'Unregistered recipient', '998399']) {
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

test('Manager Chat Support: live two-way chat, attachments, internal notes, read receipts; documents', async () => {
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const c = S.customer, st = S.staff;

  await c.click('nav[aria-label="Dashboard"] >> text=chat');
  await c.getByText('Manager Chat Support').first().waitFor();
  await st.getByRole('button', { name: 'Client inbox' }).click();
  await st.getByRole('heading', { name: 'Client inbox' }).waitFor();
  await st.click('[data-testid="inbox-row"] >> text=Riya Lifestyle Pvt Ltd');
  await st.getByText('No messages yet.', { exact: false }).waitFor();

  // Client → staff, live (no reload on the staff side), with an attachment.
  await c.setInputFiles('[data-testid="chat-file"]', { name: 'listing-brief.pdf', mimeType: 'application/pdf', buffer: PDF });
  await c.fill('textarea[aria-label="Message"]', 'Please prioritise the jute rug campaign — brief attached.');
  await c.click('button:has-text("Send")');
  // Delivered: shows "Sent", or already "Seen" if the manager's open chat marked it read instantly.
  await c.getByTestId('chat-message').filter({ hasText: 'brief attached' }).getByText(/· (Sent|Seen)$/).waitFor();
  const onStaff = st.getByTestId('chat-message').filter({ hasText: 'Please prioritise the jute rug campaign' });
  await onStaff.waitFor();
  assert.ok(await onStaff.getByText('listing-brief.pdf').isVisible(), 'attachment shown to staff');

  // Staff opened it → client sees "Seen" live.
  await c.getByTestId('chat-message').filter({ hasText: 'brief attached' }).getByText('Seen', { exact: false }).waitFor();

  // Internal note (staff only) + reply.
  await st.check('text=Internal note (never shown to the client)');
  await st.fill('textarea[aria-label="Message"]', 'Margin is thin on SKU JR-02, keep bids low');
  await st.click('button:has-text("Send")');
  await st.getByText('Internal note · not visible to client').waitFor();
  await st.uncheck('text=Internal note (never shown to the client)');
  await st.fill('textarea[aria-label="Message"]', 'Got it Riya — campaign goes live after your budget approval.');
  await st.click('button:has-text("Send")');

  await c.getByTestId('chat-message').filter({ hasText: 'campaign goes live after your budget approval' }).waitFor();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await c.getByText('Margin is thin', { exact: false }).count(), 0, 'internal note never reaches the client UI');
  await c.reload();
  await c.click('nav[aria-label="Dashboard"] >> text=chat');
  await c.getByTestId('chat-message').filter({ hasText: 'campaign goes live' }).waitFor();
  assert.equal(await c.getByText('Margin is thin', { exact: false }).count(), 0, 'nor its history');
  await c.screenshot({ path: join(SHOTS, '6-client-chat.png'), fullPage: true });
  await st.screenshot({ path: join(SHOTS, '7-staff-inbox.png'), fullPage: true });

  // Attachment downloads through the proxy with the original bytes.
  const href = await c.getByText('listing-brief.pdf').first().getAttribute('href');
  const res = await c.request.get(webBase + href);
  assert.equal(res.status(), 200);
  assert.ok(Buffer.from(await res.body()).equals(PDF));

  // Documents tab: upload, list, unsafe file rejected.
  await c.click('nav[aria-label="Dashboard"] >> text=documents');
  await c.setInputFiles('#doc-file', { name: 'GST certificate.pdf', mimeType: 'application/pdf', buffer: PDF });
  await c.selectOption('#doc-kind', 'GST_CERT');
  await c.click('button:has-text("Upload")');
  await c.getByText('Uploaded.').waitFor();
  await c.getByRole('cell', { name: 'GST_certificate.pdf' }).waitFor();
  await c.setInputFiles('#doc-file', { name: 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ fake executable') });
  await c.click('button:has-text("Upload")');
  await c.getByRole('alert').getByText('Unsupported or unsafe file', { exact: false }).waitFor();
});

test('monthly reporting: staff inputs → client costs & expenses → P&L published → client report, CSV, CA pack', async () => {
  const admin = (await apiCall('POST', '/auth/login', null, ADMIN)).token;
  await apiCall('POST', '/admin/users/staff', admin, { name: 'Meera Accounts', email: 'meera@solluna.test', password: 'Meera-Passw0rd-1', staffRole: 'ACCOUNTS_EXECUTIVE' });
  const { page: st } = await newPage({ width: 1400, height: 900 });
  await st.goto(`${webBase}/login`);
  await st.fill('#email', 'meera@solluna.test'); await st.fill('#password', 'Meera-Passw0rd-1');
  await st.click('button:has-text("Sign in")');
  await st.waitForURL(/\/ops/);
  await st.getByRole('button', { name: 'Reporting' }).click();
  await st.getByRole('heading', { name: 'Monthly reporting' }).waitFor();
  await st.selectOption('#rep-period', { index: 0 }).catch(() => {});
  await st.fill('#rep-period', '2026-10');
  const amazon = st.getByRole('form', { name: 'AMAZON figures' });
  await amazon.waitFor();
  const vals = { grossSalesPaise: 100000, discountsPaise: 5000, returnsRefundsPaise: 3000, reimbursementsPaise: 1000, orders: 90, unitsSold: 100, unitsReturned: 5, cancelledOrders: 10, sessions: 3000,
    commissionPaise: 15000, fixedFeesPaise: 1000, fulfilmentPaise: 3000, shippingPaise: 1000, storagePaise: 0, otherFeesPaise: 0, adSpendPaise: 3000, adSalesPaise: 15000, impressions: 50000, clicks: 1000,
    settlementPaise: 70000, bankCreditPaise: 69000, reservesPaise: 1000 };
  for (const [k, v] of Object.entries(vals)) await amazon.locator(`#AMAZON-${k}`).fill(String(v));
  await amazon.locator('#AMAZON-sku').fill('JR-01,60,60000,12000,2000\nJR-02,40,33000,8000,1000');
  await amazon.getByRole('button', { name: 'Save Amazon figures' }).click();
  await st.getByText('Amazon figures saved.').waitFor();
  await st.getByText('Product cost missing for: JR-01, JR-02', { exact: false }).count(); // detail lives in the preview gaps
  assert.ok(await st.getByText(/data gap\(s\): .*product cost/i).isVisible(), 'preview says product cost is missing');

  // Client provides costs + expenses, confirms.
  const c = S.customer;
  await c.goto(`${webBase}/dashboard?tab=reports`);
  await c.getByRole('heading', { name: 'Reports' }).waitFor();
  await c.fill('#period', '2026-10');
  for (const [sku, cost] of [['JR-01', '400'], ['JR-02', '300']]) {
    await c.fill('#c-sku', sku); await c.fill('#c-cost', cost); await c.fill('#c-from', '2026-10-01');
    await c.click('form[aria-label="Add product cost"] button:has-text("Save")');
    await c.getByText('Cost saved.').waitFor();
  }
  await c.selectOption('#x-cat', 'RENT'); await c.fill('#x-desc', 'Warehouse rent'); await c.fill('#x-amt', '10000');
  await c.click('form[aria-label="Add expense"] button:has-text("Add")');
  await c.getByRole('cell', { name: /Warehouse rent/ }).waitFor();
  await c.click('button:has-text("Confirm this list is complete")');
  await c.getByText('Expenses confirmed as complete for this month.').waitFor();

  // Staff: preview now verified → generate → publish.
  await st.fill('#rep-period', '2026-09'); await st.fill('#rep-period', '2026-10');
  await st.getByText('2 SKU cost(s), 1 expense(s), confirmed', { exact: false }).waitFor();
  await st.click('button:has-text("Generate P&L draft")');
  await st.getByText('Draft generated. Review it, then publish.').waitFor();
  const version = st.getByTestId('report-version').filter({ hasText: 'P&L v1' });
  await version.getByText('Verified').waitFor(); // list reloads after the confirmation message
  await st.screenshot({ path: join(SHOTS, '8-ops-reporting.png'), fullPage: true });
  await version.getByRole('button', { name: 'Publish' }).click();
  await st.getByText('Published. The client has been notified.').waitFor();

  // Client opens the published report.
  await c.reload();
  await c.getByTestId('report-row').filter({ hasText: 'October 2026 · P&L report' }).click();
  await c.waitForURL(/\/reports\//);
  const rep = c.getByRole('article', { name: 'Monthly report' });
  await rep.getByRole('heading', { name: 'October 2026' }).waitFor();
  for (const t of ['₹93,000.00', '₹36,000.00', '₹34,000.00', '₹24,000.00', 'Reconciled']) assert.ok(await rep.getByText(t, { exact: true }).first().isVisible(), `report shows ${t}`);
  assert.equal(await rep.getByText('Missing data & assumptions').count(), 0, 'complete month has no data gaps');
  await c.screenshot({ path: join(SHOTS, '9-client-pl.png'), fullPage: true });
  const csvHref = await c.getByText('Download Excel (CSV)').getAttribute('href');
  const csv = await c.request.get(webBase + csvHref);
  assert.equal(csv.status(), 200);
  assert.match(await csv.text(), /CONSOLIDATED,Operating result,24000\.00,VERIFIED/);

  // CA pack: add the month's Amazon settlement.
  await c.goto(`${webBase}/dashboard?tab=reports`);
  await c.fill('#period', '2026-10');
  const pack = c.getByRole('region', { name: 'CA documentation pack' });
  await pack.getByRole('listitem').filter({ hasText: 'Amazon settlement report' }).waitFor(); // listed as still needed
  await c.selectOption('#ca-kind', 'AMAZON_SETTLEMENT');
  await c.setInputFiles('#ca-file', { name: 'amazon-settlement-oct.csv', mimeType: 'text/csv', buffer: Buffer.from('settlement_id,amount\nS1,70000\n') });
  await c.click('form[aria-label="Add to CA pack"] button:has-text("Add")');
  await c.getByText('Added to the CA pack.').waitFor();
  await pack.getByRole('cell', { name: /amazon-settlement-oct\.csv/ }).waitFor();
  assert.ok(await pack.getByRole('cell', { name: 'Received' }).first().isVisible());
  assert.equal(await pack.getByRole('listitem').filter({ hasText: 'Amazon settlement report' }).count(), 0, 'no longer listed as missing');
  assert.ok(await pack.getByText('Tax filing, audit and certification are not included', { exact: false }).isVisible());
});

test('route guards: signed-out users go to login; customers cannot open ops', async () => {
  const { page } = await newPage();
  await page.goto(`${webBase}/dashboard`);
  await page.waitForURL(/\/login/);
  await S.customer.goto(`${webBase}/ops`);
  await S.customer.waitForURL(/\/dashboard/);
});
