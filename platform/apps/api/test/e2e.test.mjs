// End-to-end tests: real NestJS API (compiled), real Postgres, real HTTP.
// External services are replaced by local HTTP servers speaking their protocol:
//   - Razorpay Orders API mock (checks Basic auth, returns orders)
//   - Connector sink (stands in for the Zapier Catch Hook URL)
// Signatures are produced exactly as Razorpay documents them (HMAC-SHA256).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, '..');
const platformDir = join(apiDir, '..', '..');
const require = createRequire(join(platformDir, 'package.json'));
const { PrismaClient } = require('@prisma/client');

const PG = process.env.TEST_PG_ADMIN_URL ?? 'postgresql://postgres@localhost:5432/postgres';
const DB_NAME = 'solluna_e2e';
const DATABASE_URL = `postgresql://solluna:solluna@localhost:5432/${DB_NAME}`;
const KEY_ID = 'rzp_test_e2e';
const KEY_SECRET = 'e2e_key_secret';
const WEBHOOK_SECRET = 'e2e_webhook_secret';
const CONNECTOR_SECRET = 'e2e_connector_secret';
const SUPPLIER_GSTIN = '24AAJCS1234M1ZA'; // Gujarat (valid check digit)
const ADMIN = { email: 'admin@solluna.test', password: 'Admin-Passw0rd-123' };

let api, base, db, rzpServer, sinkServer;
const orders = [];      // orders received by the Razorpay mock
const connectorEvents = []; // events received by the connector sink

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

before(async () => {
  execSync(`psql "${PG}" -c "DROP DATABASE IF EXISTS ${DB_NAME}" -c "CREATE DATABASE ${DB_NAME} OWNER solluna"`, { stdio: 'pipe' });
  const env = { ...process.env, DATABASE_URL };
  execSync('npx prisma migrate deploy --schema apps/api/prisma/schema.prisma', { cwd: platformDir, env, stdio: 'pipe' });
  execSync('npx tsx apps/api/prisma/seed-plans.ts', { cwd: platformDir, env: { ...env, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, stdio: 'pipe' });

  rzpServer = createServer(async (req, res) => {
    const body = await readBody(req);
    const expected = 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
    if (req.url !== '/v1/orders' || req.method !== 'POST' || req.headers.authorization !== expected) { res.writeHead(401).end(); return; }
    const o = JSON.parse(body);
    const order = { id: `order_${orders.length + 1}${Date.now()}`, entity: 'order', amount: o.amount, currency: o.currency, receipt: o.receipt, status: 'created', notes: o.notes };
    orders.push(order);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(order));
  });
  sinkServer = createServer(async (req, res) => {
    const body = await readBody(req);
    connectorEvents.push({ body: JSON.parse(body), signature: req.headers['x-solluna-signature'], raw: body });
    res.writeHead(200).end('ok');
  });
  const rzpPort = await listen(rzpServer);
  const sinkPort = await listen(sinkServer);
  const port = 4300 + Math.floor(Math.random() * 500);
  base = `http://127.0.0.1:${port}/api`;

  api = spawn('node', ['dist/apps/api/src/main.js'], {
    cwd: apiDir,
    env: {
      ...process.env, DATABASE_URL, PORT: String(port), JWT_SECRET: 'e2e-jwt-secret-e2e-jwt-secret-1234', COOKIE_SECURE: 'false',
      RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET, RAZORPAY_API_BASE: `http://127.0.0.1:${rzpPort}`,
      CONNECTOR_WEBHOOK_URL: `http://127.0.0.1:${sinkPort}/hook`, CONNECTOR_WEBHOOK_SECRET: CONNECTOR_SECRET, RATE_LIMIT_PER_MIN: '10000', AUTH_RATE_LIMIT_PER_MIN: '40',
      SUPPLIER_LEGAL_NAME: 'SOLLUNA Marketplace Services', SUPPLIER_GSTIN: SUPPLIER_GSTIN, SUPPLIER_ADDRESS: 'B-220 Supath-2 Complex, Ahmedabad, Gujarat 380013', INVOICE_SAC: '998399',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  api.stdout.on('data', (d) => (log += d));
  api.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
    if (i === 59) throw new Error('API did not start:\n' + log);
  }
  db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
});

after(async () => {
  api?.kill();
  rzpServer?.close();
  sinkServer?.close();
  await db?.$disconnect();
});

// ───────────── helpers ─────────────
async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined && raw === undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, headers: r.headers };
}
const ok = (r, code = [200, 201]) => { assert.ok([].concat(code).includes(r.status), `HTTP ${r.status}: ${JSON.stringify(r.body)}`); return r.body; };
let seq = 0;
async function registerCustomer(name) {
  seq++;
  const r = await call('POST', '/auth/register', { body: {
    name: `${name} Owner`, email: `${name.toLowerCase()}${seq}@seller.test`, phone: `98${String(10000000 + seq).slice(-8)}`, password: 'Seller-Pass-123', legalName: `${name} Traders Pvt Ltd`,
  } });
  return ok(r).token;
}
async function login(email, password) { return ok(await call('POST', '/auth/login', { body: { email, password } })).token; }
const sign = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');
const PROFILE = { address: '12 MG Road, Andheri East', city: 'Mumbai', pincode: '400069', stateCode: '27' };
async function pay(token, planCode, profile = PROFILE) {
  if (profile) ok(await call('PATCH', '/billing/profile', { token, body: profile }));
  const co = ok(await call('POST', '/billing/checkout', { token, body: { planCode } }));
  const paymentId = `pay_${co.orderId}`;
  ok(await call('POST', '/billing/verify', { token, body: { razorpay_order_id: co.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(KEY_SECRET, `${co.orderId}|${paymentId}`) } }));
  return co;
}
async function staff(role, adminToken) {
  seq++;
  const email = `${role.toLowerCase()}${seq}@solluna.test`;
  const created = ok(await call('POST', '/admin/users/staff', { token: adminToken, body: { name: role, email, password: 'Staff-Passw0rd-1', staffRole: role } }));
  return { id: created.id, token: await login(email, 'Staff-Passw0rd-1') };
}
const tasksOf = async (token, requestId) => ok(await call('GET', `/requests/${requestId}`, { token }));
const step = (req, key) => req.request.tasks.find((t) => t.stepKey === key);
async function move(token, taskId, status, extra = {}) { return call('PATCH', `/ops/tasks/${taskId}`, { token, body: { status, ...extra } }); }
async function complete(token, taskId, evidence) {
  const s = await move(token, taskId, 'IN_PROGRESS');
  if (s.status !== 200) return s;
  return move(token, taskId, 'COMPLETED', { evidence });
}
const DRIVE = 'https://drive.google.com/drive/folders/solluna-e2e';

// ───────────── shared state across ordered tests ─────────────
const S = {};

test('auth: registration validation, duplicates, login, session cookie, me', async () => {
  const bad = await call('POST', '/auth/register', { body: { name: 'X', email: 'not-an-email', phone: '123', password: 'short', legalName: 'Y' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.issues.some((i) => i.path === 'phone'));

  const r = await call('POST', '/auth/register', { body: { name: 'Asha Mehta', email: 'Asha@Seller.test', phone: '9876543210', password: 'Seller-Pass-123', legalName: 'Asha Home Decor LLP', gstin: '24ABCDE1234F1Z6' } });
  ok(r);
  assert.match(r.headers.get('set-cookie'), /solluna_session=.*HttpOnly/i);
  S.a = r.body.token;

  assert.equal((await call('POST', '/auth/register', { body: { name: 'Dup', email: 'asha@seller.test', phone: '9876500000', password: 'Seller-Pass-123', legalName: 'Dup' } })).status, 409);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'asha@seller.test', password: 'wrong-password' } })).status, 401);
  S.a = await login('asha@seller.test', 'Seller-Pass-123');
  const me = ok(await call('GET', '/auth/me', { token: S.a }));
  assert.equal(me.user.type, 'CUSTOMER');
  assert.equal(me.organization.gstin, '24ABCDE1234F1Z6');
  const badGstin = await call('POST', '/auth/register', { body: { name: 'Bad Gst', email: 'bad@gst.test', phone: '9876500011', password: 'Seller-Pass-123', legalName: 'Bad GST Co', gstin: '24ABCDE1234F1Z5' } });
  assert.equal(badGstin.status, 400, 'GSTIN with wrong check digit rejected');
  assert.equal((await call('GET', '/auth/me')).status, 401);
  S.admin = await login(ADMIN.email, ADMIN.password);
});

test('features: all 28 services are linked to installed skills; no plan = no access', async () => {
  const cat = ok(await call('GET', '/features', { token: S.a }));
  assert.equal(cat.features.length, 28);
  assert.equal(cat.plan, null);
  assert.ok(cat.features.every((f) => f.access === 'NO_ACTIVE_SUBSCRIPTION'));
  const skills = ok(await call('GET', '/skills', { token: S.admin }));
  for (const f of cat.features) assert.ok(skills.some((s) => s.name === f.skill), `skill ${f.skill} not served`);
  assert.equal(skills.length, 29);
  assert.equal(cat.features.find((f) => f.key === 'MONTHLY_PL_REPORT').skill, 'monthly-pl-report');
  assert.deepEqual(cat.features.find((f) => f.key === 'MONTHLY_PL_REPORT').connectors, ['GOOGLE_DRIVE', 'GOOGLE_SHEETS']);
});

test('orchestrator: request without a plan is blocked as out of plan, with a client update', async () => {
  const r = ok(await call('POST', '/requests', { token: S.a, body: { featureKey: 'CATALOG_MAPPING', title: 'Map my 40 cushion covers', marketplace: 'AMAZON' } }));
  assert.equal(r.request.status, 'BLOCKED');
  assert.equal(r.request.entitlement, 'OUT_OF_PLAN');
  assert.match(r.update.text, /You do not have an active plan/);
  assert.match(r.update.text, /\*\*Next step:\*\* You: choose a plan/);
});

test('billing: invalid signature never activates; payment in flight = plan verification', async () => {
  const noProfile = await call('POST', '/billing/checkout', { token: S.a, body: { planCode: 'RESELLER' } });
  assert.equal(noProfile.status, 400, 'billing address required for the GST invoice');
  assert.match(noProfile.body.message, /billing address/);
  assert.equal((await call('PATCH', '/billing/profile', { token: S.a, body: { gstin: '24ABCDE1234F1Z6', address: '4 CG Road', city: 'Ahmedabad', pincode: '12345' } })).status, 400, 'bad PIN');
  const prof = ok(await call('PATCH', '/billing/profile', { token: S.a, body: { gstin: '24ABCDE1234F1Z6', stateCode: '27', address: '4 CG Road, Navrangpura', city: 'Ahmedabad', pincode: '380009' } }));
  assert.equal(prof.stateCode, '24', 'GSTIN state wins over a conflicting selected state');
  const co = ok(await call('POST', '/billing/checkout', { token: S.a, body: { planCode: 'RESELLER' } }));
  // GST-exclusive: ₹1,999 + 18% GST, intra-state (Gujarat → Gujarat) = CGST 9% + SGST 9%
  assert.equal(co.amount, 235882);
  assert.deepEqual([co.tax.taxablePaise, co.tax.cgstPaise, co.tax.sgstPaise, co.tax.igstPaise], [199900, 17991, 17991, 0]);
  assert.equal(co.keyId, KEY_ID);
  const order = orders.find((o) => o.id === co.orderId);
  assert.equal(order.amount, 235882, 'Razorpay is charged the GST-inclusive total');
  assert.equal(order.notes.planCode, 'RESELLER');

  const forged = await call('POST', '/billing/verify', { token: S.a, body: { razorpay_order_id: co.orderId, razorpay_payment_id: 'pay_x', razorpay_signature: sign('wrong-secret', `${co.orderId}|pay_x`) } });
  assert.equal(forged.status, 400);
  const cat = ok(await call('GET', '/features', { token: S.a }));
  assert.equal(cat.plan, null, 'subscription must stay inactive');
  assert.equal(cat.subscriptionVerified, null, 'payment in flight = pending verification');

  const pending = ok(await call('POST', '/requests', { token: S.a, body: { featureKey: 'CATALOG_MAPPING', title: 'Map 12 bedsheet SKUs', marketplace: 'FLIPKART' } }));
  assert.equal(pending.request.status, 'PLAN_VERIFICATION');
  S.pendingRequest = pending.request.id;
  S.aOrder = co;
});

test('billing: verified checkout activates once, issues GST invoice, resumes waiting requests, fires connector', async () => {
  const paymentId = 'pay_A1';
  const v = ok(await call('POST', '/billing/verify', { token: S.a, body: { razorpay_order_id: S.aOrder.orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(KEY_SECRET, `${S.aOrder.orderId}|${paymentId}`) } }));
  assert.deepEqual(v, { status: 'ACTIVE', alreadyActive: false });

  // Webhook for the same payment is idempotent.
  const evt = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: S.aOrder.orderId, amount: 235882, status: 'captured' } } } });
  const wh = ok(await call('POST', '/billing/webhook/razorpay', { raw: evt, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(WEBHOOK_SECRET, evt) } }));
  assert.equal(wh.alreadyActive, true);
  assert.equal((await call('POST', '/billing/webhook/razorpay', { raw: evt, headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'deadbeef' } })).status, 400);

  const billing = ok(await call('GET', '/billing', { token: S.a }));
  assert.equal(billing.subscriptions.filter((s) => s.status === 'ACTIVE').length, 1);
  assert.equal(billing.invoices.length, 1);
  const inv = billing.invoices[0];
  assert.equal(inv.number, 'SOL/26-27/00001');
  assert.ok(inv.number.length <= 16, 'Rule 46: invoice number ≤ 16 characters');
  assert.deepEqual([inv.taxablePaise, inv.cgstPaise, inv.sgstPaise, inv.igstPaise, inv.gstPaise, inv.amountPaise], [199900, 17991, 17991, 0, 35982, 235882]);
  assert.equal(inv.placeOfSupply, '24');
  assert.equal(inv.sac, '998399');
  const full = ok(await call('GET', `/billing/invoices/${inv.id}`, { token: S.a }));
  assert.equal(full.amountInWords, 'Rupees Two Thousand Three Hundred Fifty Eight and Eighty Two Paise Only');
  assert.equal(full.supplier.gstin, SUPPLIER_GSTIN);
  assert.equal(full.supplier.pan, 'AAJCS1234M');
  assert.equal(full.buyer.gstin, '24ABCDE1234F1Z6');
  assert.equal(full.buyer.stateName, 'Gujarat');
  assert.equal(full.placeOfSupplyName, 'Gujarat');
  assert.equal(full.reverseCharge, 'No');
  S.aInvoice = inv.id;

  const resumed = ok(await call('GET', `/requests/${S.pendingRequest}`, { token: S.a }));
  assert.equal(resumed.request.status, 'QUEUED', 'request waiting on plan verification resumes automatically');
  assert.equal(resumed.request.tasks[0].skill, 'existing-catalog-mapping');

  const activated = connectorEvents.find((e) => e.body.type === 'subscription.activated');
  assert.ok(activated, 'connector webhook received activation');
  assert.equal(activated.signature, sign(CONNECTOR_SECRET, activated.raw));
  assert.match(activated.body.body, /Reseller plan is active/);
  const notes = ok(await call('GET', '/notifications', { token: S.a }));
  assert.ok(notes.some((n) => n.type === 'subscription.activated'));
});

test('billing: failed payment keeps the subscription inactive and notifies the client', async () => {
  S.b = await registerCustomer('Bharat');
  ok(await call('PATCH', '/billing/profile', { token: S.b, body: PROFILE }));
  const co = ok(await call('POST', '/billing/checkout', { token: S.b, body: { planCode: 'GROWTH' } }));
  assert.equal(co.amount, 589882); // ₹4,999 + 18% IGST (Maharashtra buyer, Gujarat supplier)
  const evt = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_fail', order_id: co.orderId, amount: 589882, status: 'failed', error_description: 'Card declined by bank' } } } });
  ok(await call('POST', '/billing/webhook/razorpay', { raw: evt, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(WEBHOOK_SECRET, evt) } }));
  const billing = ok(await call('GET', '/billing', { token: S.b }));
  assert.equal(billing.payments[0].status, 'FAILED');
  assert.equal(billing.payments[0].failureReason, 'Card declined by bank');
  assert.ok(billing.subscriptions.every((s) => s.status !== 'ACTIVE'));
  assert.ok(ok(await call('GET', '/notifications', { token: S.b })).some((n) => n.type === 'payment.failed'));
  // Then the client pays successfully.
  await pay(S.b, 'GROWTH');
  assert.equal(ok(await call('GET', '/features', { token: S.b })).plan.code, 'GROWTH');
  const bInv = ok(await call('GET', '/billing', { token: S.b })).invoices[0];
  assert.equal(bInv.number, 'SOL/26-27/00002', 'gap-free sequence: the failed payment issued no invoice');
  assert.deepEqual([bInv.taxablePaise, bInv.cgstPaise, bInv.sgstPaise, bInv.igstPaise, bInv.amountPaise, bInv.intraState], [499900, 0, 0, 89982, 589882, false]);
  assert.equal((await call('GET', `/billing/invoices/${S.aInvoice}`, { token: S.b })).status, 404, "another client's invoice is not visible");
  const accounts = await staff('ACCOUNTS_EXECUTIVE', S.admin);
  assert.equal(ok(await call('GET', `/billing/admin/invoices/${S.aInvoice}`, { token: accounts.token })).number, 'SOL/26-27/00001');
  const lister = await staff('LISTING_EXECUTIVE', S.admin);
  assert.equal((await call('GET', `/billing/admin/invoices/${S.aInvoice}`, { token: lister.token })).status, 403);
});

test('workflow: new Amazon listing — catalog check → new listing → SEO, evidence-gated, quota consumed once', async () => {
  S.lister = await staff('LISTING_EXECUTIVE', S.admin);
  const r = ok(await call('POST', '/requests', { token: S.a, body: { featureKey: 'NEW_LISTING_AMAZON', title: 'List jute table runner (new design)', details: { sku: 'JTR-001', mrp: 1499 } } }));
  assert.equal(r.request.marketplace, 'AMAZON');
  let req = await tasksOf(S.a, r.request.id);
  assert.deepEqual(req.request.tasks.map((t) => [t.stepKey, t.status, t.skill]), [
    ['catalog-check', 'QUEUED', 'existing-catalog-mapping'],
    ['create-listing', 'NEW', 'amazon-new-listings'],
    ['seo', 'NEW', 'seo-keyword-optimization'],
  ]);

  const check = step(req, 'catalog-check').id;
  const ctx = ok(await call('GET', `/ops/tasks/${check}/context`, { token: S.lister.token }));
  assert.equal(ctx.skill.name, 'existing-catalog-mapping');
  assert.match(ctx.skill.instructions, /Match confidence and decision rules/);
  assert.deepEqual(ctx.completionRequirements.outcomes, ['EXISTING_FOUND', 'NO_MATCH_FOUND']);
  assert.equal(ctx.client.plan.code, 'RESELLER');

  assert.equal((await move(S.lister.token, check, 'COMPLETED')).status, 400, 'cannot jump QUEUED → COMPLETED');
  ok(await move(S.lister.token, check, 'IN_PROGRESS'));
  assert.equal((await move(S.lister.token, check, 'COMPLETED', { evidence: { summary: 'x' } })).status, 400, 'evidence required');
  assert.equal((await move(S.lister.token, check, 'COMPLETED', { evidence: { summary: 'Searched by GTIN and title', outputUrl: 'https://example.com/file', outcome: 'NO_MATCH_FOUND' } })).status, 400, 'unapproved delivery channel');
  assert.equal((await move(S.lister.token, check, 'COMPLETED', { evidence: { summary: 'Searched by GTIN and title', outputUrl: DRIVE, outcome: 'EXISTING_FOUND', catalogId: 'B0TEST', confidence: 'REVIEW_REQUIRED' } })).status, 400, 'unverified match rejected');
  ok(await move(S.lister.token, check, 'COMPLETED', { evidence: { summary: 'Searched GTIN, model and title — no existing ASIN', outputUrl: DRIVE, outcome: 'NO_MATCH_FOUND' } }));

  req = await tasksOf(S.a, r.request.id);
  assert.equal(step(req, 'create-listing').status, 'QUEUED');
  assert.equal(step(req, 'seo').status, 'NEW');
  ok(await complete(S.lister.token, step(req, 'create-listing').id, { summary: 'Listing live after processing report clean', marketplaceRef: 'Seller Central feed 12345', outcome: 'CATALOG_ID_CREATED', catalogId: 'B0NEWASIN1' }));
  req = await tasksOf(S.a, r.request.id);
  ok(await complete(S.lister.token, step(req, 'seo').id, { summary: 'Title, bullets and backend terms optimized', outputUrl: 'https://docs.google.com/spreadsheets/d/kw' }));

  req = await tasksOf(S.a, r.request.id);
  assert.equal(req.request.status, 'COMPLETED');
  assert.match(req.update.text, /Create the new listing — Listing live/);
  assert.match(req.update.text, /\*\*Next step:\*\* No further action/);
  const amazon = ok(await call('GET', '/features', { token: S.a })).features.find((f) => f.key === 'NEW_LISTING_AMAZON');
  assert.equal(amazon.used, 1);
  assert.equal(amazon.remaining, 1); // 3 − 1 used − this check's unit
});

test('workflow: existing catalog match skips new listing + SEO and does not consume quota', async () => {
  const r = ok(await call('POST', '/requests', { token: S.a, body: { featureKey: 'NEW_LISTING_AMAZON', title: 'List cotton cushion cover 16x16' } }));
  let req = await tasksOf(S.a, r.request.id);
  ok(await complete(S.lister.token, step(req, 'catalog-check').id, { summary: 'Exact GTIN match on existing ASIN, attributes consistent', outputUrl: DRIVE, outcome: 'EXISTING_FOUND', catalogId: 'B0EXIST01', confidence: 'EXACT_VERIFIED' }));
  req = await tasksOf(S.a, r.request.id);
  assert.equal(req.request.status, 'COMPLETED');
  assert.equal(step(req, 'create-listing').status, 'CANCELLED');
  assert.match(step(req, 'create-listing').blocker, /^Skipped: Mapped to an existing catalog entry/);
  assert.match(req.update.text, /not required/);
  const amazon = ok(await call('GET', '/features', { token: S.a })).features.find((f) => f.key === 'NEW_LISTING_AMAZON');
  assert.equal(amazon.used, 1, 'mapping does not use new-listing quota');
});

test('quota: Reseller gets 3 new Amazon listings per billing month (reserved while in flight); Flipkart is separate', async () => {
  const mk = (t) => call('POST', '/requests', { token: S.a, body: { featureKey: 'NEW_LISTING_AMAZON', title: t } }).then(ok);
  const r2 = await mk('Listing 2');
  const r3 = await mk('Listing 3');
  assert.equal(r2.request.status, 'QUEUED');
  assert.equal(r3.request.status, 'QUEUED');
  const r4 = await mk('Listing 4');
  assert.equal(r4.request.status, 'BLOCKED');
  assert.equal(r4.request.entitlement, 'LIMIT_REACHED');
  assert.match(r4.update.text, /includes 3 new amazon listings per billing month/i);
  const fk = ok(await call('POST', '/requests', { token: S.a, body: { featureKey: 'NEW_LISTING_FLIPKART', title: 'Flipkart listing 1' } }));
  assert.equal(fk.request.status, 'QUEUED');
  assert.equal(fk.request.marketplace, 'FLIPKART');
  assert.equal((await call('POST', '/requests', { token: S.a, body: { featureKey: 'NEW_LISTING_FLIPKART', marketplace: 'AMAZON', title: 'wrong' } })).status, 400);
});

test('entitlements: Reseller cannot use Growth/Premium services — backend blocks, no tasks created', async () => {
  for (const featureKey of ['ADS_MANAGEMENT', 'SHIPPING_LABEL_GENERATION', 'PRODUCT_RESEARCH']) {
    const r = ok(await call('POST', '/requests', { token: S.a, body: { featureKey, title: `Try ${featureKey}`, marketplace: 'AMAZON' } }));
    assert.equal(r.request.entitlement, 'OUT_OF_PLAN', featureKey);
    assert.match(r.update.text, /not included in your Reseller plan/);
    assert.equal(ok(await call('GET', `/requests/${r.request.id}`, { token: S.a })).request.tasks.length, 0);
  }
});

test('workflow: advertising requires explicit client approval of budget before launch', async () => {
  S.ads = await staff('ADS_MANAGER', S.admin);
  const r = ok(await call('POST', '/requests', { token: S.b, body: { featureKey: 'ADS_MANAGEMENT', marketplace: 'AMAZON', title: 'Launch Sponsored Products for steel bottles' } }));
  let req = await tasksOf(S.b, r.request.id);
  assert.deepEqual(req.request.tasks.map((t) => t.status), ['QUEUED', 'NEW', 'NEW']);
  const strategy = step(req, 'strategy').id;
  assert.equal((await complete(S.ads.token, strategy, { summary: 'Campaign plan prepared with break-even ACOS 28%', outputUrl: 'https://docs.google.com/spreadsheets/d/ads' })).status, 400, 'approval parameters required for the gated next step');
  ok(await move(S.ads.token, strategy, 'COMPLETED', { evidence: { summary: 'Campaign plan prepared with break-even ACOS 28%', outputUrl: 'https://docs.google.com/spreadsheets/d/ads', approvalParameters: { dailyBudgetInr: 500, campaigns: 2, durationDays: 30 } } }));

  req = await tasksOf(S.b, r.request.id);
  const launch = step(req, 'launch');
  assert.equal(launch.status, 'AWAITING_CLIENT_APPROVAL');
  assert.equal(req.request.status, 'AWAITING_CLIENT_APPROVAL');
  assert.match(req.update.text, /You: review and approve "Launch campaigns as approved"/);
  assert.match(req.update.text, /dailyBudgetInr/);
  assert.equal((await move(S.ads.token, launch.id, 'IN_PROGRESS')).status, 400, 'staff cannot bypass approval');
  assert.ok(connectorEvents.some((e) => e.body.type === 'approval.requested' && e.body.data.requestId === r.request.id));

  const approvals = ok(await call('GET', '/approvals', { token: S.b }));
  const ap = approvals.find((a) => a.taskId === launch.id);
  assert.deepEqual(ap.parameters, { dailyBudgetInr: 500, campaigns: 2, durationDays: 30 });
  assert.equal((await call('POST', `/approvals/${ap.id}/decision`, { token: S.a, body: { decision: 'APPROVED' } })).status, 404, 'another client cannot approve');
  ok(await call('POST', `/approvals/${ap.id}/decision`, { token: S.b, body: { decision: 'APPROVED' } }));
  assert.equal((await call('POST', `/approvals/${ap.id}/decision`, { token: S.b, body: { decision: 'APPROVED' } })).status, 400, 'decided once');

  req = await tasksOf(S.b, r.request.id);
  assert.equal(step(req, 'launch').status, 'QUEUED');
  ok(await complete(S.ads.token, launch.id, { summary: '2 campaigns live at ₹500/day', marketplaceRef: 'Campaign IDs 111,222' }));
  req = await tasksOf(S.b, r.request.id);
  ok(await complete(S.ads.token, step(req, 'report').id, { summary: 'Week 1: spend ₹3,400, ACOS 24%', outputUrl: 'https://docs.google.com/spreadsheets/d/ads-report' }));
  assert.equal((await tasksOf(S.b, r.request.id)).request.status, 'COMPLETED');
});

test('workflow: declined approval cancels the gated step and everything after it', async () => {
  const r = ok(await call('POST', '/requests', { token: S.b, body: { featureKey: 'ADS_MANAGEMENT', marketplace: 'FLIPKART', title: 'Flipkart PLA test' } }));
  let req = await tasksOf(S.b, r.request.id);
  ok(await complete(S.ads.token, step(req, 'strategy').id, { summary: 'PLA plan with ₹300/day', outputUrl: 'https://docs.google.com/spreadsheets/d/pla', approvalParameters: { dailyBudgetInr: 300 } }));
  const ap = ok(await call('GET', '/approvals', { token: S.b })).find((a) => a.status === 'REQUESTED');
  ok(await call('POST', `/approvals/${ap.id}/decision`, { token: S.b, body: { decision: 'DECLINED' } }));
  req = await tasksOf(S.b, r.request.id);
  assert.deepEqual(req.request.tasks.map((t) => t.status), ['COMPLETED', 'CANCELLED', 'CANCELLED']);
  assert.equal(req.request.status, 'PARTIALLY_COMPLETED');
});

test('workflow: shipping labels include thank-you inserts only for Premium', async () => {
  const growth = ok(await call('POST', '/requests', { token: S.b, body: { featureKey: 'SHIPPING_LABEL_GENERATION', marketplace: 'AMAZON', title: 'Labels for today' } }));
  assert.deepEqual((await tasksOf(S.b, growth.request.id)).request.tasks.map((t) => t.stepKey), ['generate', 'deliver']);

  S.c = await registerCustomer('Chandra');
  await pay(S.c, 'PREMIUM');
  const prem = ok(await call('POST', '/requests', { token: S.c, body: { featureKey: 'SHIPPING_LABEL_GENERATION', marketplace: 'FLIPKART', title: 'Labels for today' } }));
  let req = await tasksOf(S.c, prem.request.id);
  assert.deepEqual(req.request.tasks.map((t) => [t.stepKey, t.skill]), [
    ['generate', 'shipping-label-generation'], ['thank-you-notes', 'personalized-thank-you-notes'], ['deliver', 'daily-label-processing-delivery'],
  ]);
  const opsMgr = await staff('OPERATIONS_MANAGER', S.admin);
  ok(await complete(opsMgr.token, step(req, 'generate').id, { summary: '42 labels generated and order-matched', outputUrl: DRIVE }));
  req = await tasksOf(S.c, prem.request.id);
  assert.equal(step(req, 'thank-you-notes').status, 'QUEUED');
  assert.equal(step(req, 'deliver').status, 'NEW', 'deliver waits for both labels and inserts');
  ok(await complete(opsMgr.token, step(req, 'thank-you-notes').id, { summary: '42 inserts prepared, labels untouched', outputUrl: DRIVE }));
  req = await tasksOf(S.c, prem.request.id);
  assert.equal(step(req, 'deliver').status, 'QUEUED');
});

test('isolation and roles: tenants, staff role scopes, customer vs staff APIs', async () => {
  const aReqs = ok(await call('GET', '/requests', { token: S.a }));
  const bReqs = ok(await call('GET', '/requests', { token: S.b }));
  assert.ok(aReqs.length > 0 && bReqs.length > 0);
  assert.ok(!bReqs.some((r) => aReqs.some((x) => x.id === r.id)));
  assert.equal((await call('GET', `/requests/${aReqs[0].id}`, { token: S.b })).status, 404);
  assert.equal((await call('GET', '/ops/tasks', { token: S.a })).status, 403, 'customers cannot reach ops');
  assert.equal((await call('GET', '/features', { token: S.admin })).status, 403, 'staff do not have a customer catalog');

  const listerQueue = ok(await call('GET', '/ops/tasks', { token: S.lister.token }));
  assert.ok(listerQueue.length > 0);
  assert.ok(listerQueue.every((t) => ['CATALOG_MAPPING', 'NEW_LISTING_AMAZON', 'NEW_LISTING_FLIPKART', 'SEO_KEYWORD_OPTIMIZATION'].includes(t.featureKey) || t.featureKey.startsWith('SELLER') || t.featureKey === 'BRAND_APPROVAL' || t.featureKey === 'LISTING_HEALTH_MONITORING'));
  const adsTask = await db.task.findFirst({ where: { featureKey: 'ADS_MANAGEMENT' } });
  assert.ok(adsTask, 'fixture: an ads task exists');
  assert.equal((await call('GET', `/ops/tasks/${adsTask.id}/context`, { token: S.lister.token })).status, 404, 'listing exec cannot open ads tasks');
  assert.equal((await call('PATCH', `/ops/tasks/${adsTask.id}`, { token: S.lister.token, body: { status: 'CANCELLED' } })).status, 404, 'listing exec cannot change ads tasks');
  ok(await call('GET', `/ops/tasks/${adsTask.id}/context`, { token: S.ads.token }));
  assert.equal((await call('POST', '/admin/users/staff', { token: S.lister.token, body: {} })).status, 403);
});

test('access revocation: a disabled employee loses access on the very next request', async () => {
  ok(await call('GET', '/ops/tasks', { token: S.lister.token }));
  ok(await call('PATCH', `/admin/users/${S.lister.id}/deactivate`, { token: S.admin }));
  assert.equal((await call('GET', '/ops/tasks', { token: S.lister.token })).status, 401);
  const audit = await db.auditLog.findFirst({ where: { action: 'user.deactivate', entityId: S.lister.id } });
  assert.ok(audit);
});

test('lifecycle: renewal reminder → grace period (service continues) → past due (service stops)', async () => {
  const sub = await db.subscription.findFirst({ where: { status: 'ACTIVE', organization: { users: { some: { email: 'asha@seller.test' } } } } });
  await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: new Date(Date.now() + 2 * 86400000) } });
  let sw = ok(await call('POST', '/billing/sweep', { token: S.admin }));
  assert.ok(sw.reminders >= 1);
  sw = ok(await call('POST', '/billing/sweep', { token: S.admin }));
  assert.equal(sw.reminders, 0, 'reminder sent once per period');

  await db.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
  ok(await call('POST', '/billing/sweep', { token: S.admin }));
  let cat = ok(await call('GET', '/features', { token: S.a }));
  assert.equal(cat.plan.status, 'GRACE_PERIOD');
  assert.equal(cat.features.find((f) => f.key === 'MANAGER_CHAT').access, 'ALLOWED', 'services continue in grace');

  await db.subscription.update({ where: { id: sub.id }, data: { graceUntil: new Date(Date.now() - 1000) } });
  ok(await call('POST', '/billing/sweep', { token: S.admin }));
  cat = ok(await call('GET', '/features', { token: S.a }));
  assert.equal(cat.plan, null);
  assert.ok(cat.features.every((f) => f.access === 'NO_ACTIVE_SUBSCRIPTION'));
  assert.ok(ok(await call('GET', '/notifications', { token: S.a })).some((n) => n.type === 'subscription.past_due'));
});

test('billing month: quota periods roll monthly from the subscription anchor', async () => {
  const { billingMonthStart } = require(join(apiDir, 'dist/apps/api/src/features/entitlements.service.js'));
  const anchor = new Date('2026-01-15T10:00:00Z');
  assert.equal(billingMonthStart(anchor, new Date('2026-01-20T00:00:00Z')).toISOString(), '2026-01-15T10:00:00.000Z');
  assert.equal(billingMonthStart(anchor, new Date('2026-03-14T00:00:00Z')).toISOString(), '2026-02-15T10:00:00.000Z');
  assert.equal(billingMonthStart(anchor, new Date('2026-03-15T11:00:00Z')).toISOString(), '2026-03-15T10:00:00.000Z');
});

test('security: login brute force is rate limited per IP', async () => {
  let limited = false;
  for (let i = 0; i < 45 && !limited; i++) {
    const r = await call('POST', '/auth/login', { body: { email: 'asha@seller.test', password: `guess-${i}` } });
    limited = r.status === 429;
  }
  assert.ok(limited, 'expected HTTP 429 after repeated failed logins');
  assert.ok(await db.auditLog.count({ where: { action: 'auth.login_failed' } }) > 5, 'failed logins are audited');
});
