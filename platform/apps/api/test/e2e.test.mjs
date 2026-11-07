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
const SUPPLIER_GSTIN = '24OPVPS8924H1ZQ'; // Solluna (GST REG-06), Gujarat
const ADMIN = { email: 'admin@solluna.test', password: 'Admin-Passw0rd-123' };

let api, base, db, rzpServer, sinkServer, claude;
import { startClaudeMock, PRODUCT } from './claude-mock.mjs';
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
  claude = await startClaudeMock();
  const port = 4300 + Math.floor(Math.random() * 500);
  base = `http://127.0.0.1:${port}/api`;

  api = spawn('node', ['dist/apps/api/src/main.js'], {
    cwd: apiDir,
    env: {
      ...process.env, DATABASE_URL, PORT: String(port), JWT_SECRET: 'e2e-jwt-secret-e2e-jwt-secret-1234', COOKIE_SECURE: 'false',
      RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET, RAZORPAY_API_BASE: `http://127.0.0.1:${rzpPort}`,
      CONNECTOR_WEBHOOK_URL: `http://127.0.0.1:${sinkPort}/hook`, CONNECTOR_WEBHOOK_SECRET: CONNECTOR_SECRET, RATE_LIMIT_PER_MIN: '10000', AUTH_RATE_LIMIT_PER_MIN: '40', MAX_UPLOAD_MB: '1', MANAGER_ASSIGN_DELAY_MIN: '0', MANAGER_MESSAGE_GAP_SEC: '0', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${claude.port}`, LOOKUP_DAILY_LIMIT: '3',
      SUPPLIER_LEGAL_NAME: 'Aaditya Jitendrabhai Sorathia', SUPPLIER_TRADE_NAME: 'Solluna', SUPPLIER_GSTIN: SUPPLIER_GSTIN, SUPPLIER_ADDRESS: 'Survey No 135, Plot No 9, Shreeji Nagar, Meghpar Kumbhardi Sim, Anjar, Kachchh, Gujarat 370110', INVOICE_SAC: '998399',
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
  rzpServer?.close(); claude?.close();
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
// RFC 6238 TOTP, independent of the API implementation.
function totp(secretB32, at = Date.now()) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secretB32) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
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
  // Super admins must enroll TOTP before the console opens (plan §16).
  const pending = await login(ADMIN.email, ADMIN.password);
  const gated = await call('POST', '/admin/users/staff', { token: pending, body: { name: 'X', email: 'x@solluna.test', password: 'Staff-Passw0rd-1', staffRole: 'LISTING_EXECUTIVE' } });
  assert.equal(gated.status, 403);
  assert.equal(gated.body.twoFactorSetupRequired, true);
  assert.equal(ok(await call('GET', '/auth/me', { token: pending })).user.twoFactorRequired, true);
  const setup = ok(await call('POST', '/auth/2fa/setup', { token: pending }));
  assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\/SOLLUNA/);
  assert.equal((await call('POST', '/auth/2fa/enable', { token: pending, body: { code: '000000' } })).status, 400);
  ok(await call('POST', '/auth/2fa/enable', { token: pending, body: { code: totp(setup.secret) } }));
  S.adminTotp = setup.secret;
  const noCode = await call('POST', '/auth/login', { body: ADMIN });
  assert.equal(noCode.status, 401);
  assert.equal(noCode.body.twoFactorRequired, true);
  assert.equal((await call('POST', '/auth/login', { body: { ...ADMIN, code: '123456' } })).status, 401);
  S.admin = ok(await call('POST', '/auth/login', { body: { ...ADMIN, code: totp(setup.secret) } })).token;
  assert.equal(ok(await call('GET', '/auth/me', { token: S.admin })).user.twoFactorEnabled, true);
  assert.equal((await call('POST', '/auth/2fa/disable', { token: S.admin, body: { code: totp(setup.secret) } })).status, 403, 'super admins cannot turn 2FA off');
});

test('features: all 29 services are linked to installed skills; no plan = no access', async () => {
  const cat = ok(await call('GET', '/features', { token: S.a }));
  assert.equal(cat.features.length, 29);
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
  assert.equal(full.supplier.pan, 'OPVPS8924H');
  assert.equal(full.supplier.legalName, 'Aaditya Jitendrabhai Sorathia');
  assert.equal(full.supplier.tradeName, 'Solluna');
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


// ───────────── documents & chat helpers ─────────────
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f5f1a40000000049454e44ae426082', 'hex');
async function upload(token, name, bytes, fields = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes]), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await fetch(base + '/documents', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
  return { status: r.status, body: await r.json() };
}
async function openStream(token, path) {
  const ctrl = new AbortController();
  const res = await fetch(base + path, { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' }, signal: ctrl.signal });
  const events = [];
  (async () => {
    const reader = res.body.getReader(); let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += Buffer.from(value).toString('utf8');
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const type = /^event: (.*)$/m.exec(chunk)?.[1];
          const data = /^data: (.*)$/m.exec(chunk)?.[1];
          if (data && type !== 'ping') events.push({ type, data: JSON.parse(data) });
        }
      }
    } catch {}
  })();
  return { events, status: res.status, contentType: res.headers.get('content-type'), close: () => ctrl.abort() };
}
async function waitFor(events, pred, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const e = events.find(pred); if (e) return e; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('event not received: ' + JSON.stringify(events.map((e) => e.type)));
}

test('documents: content-based type checks, size limit, visibility, tenant isolation, integrity, audit', async () => {
  const pdf = await upload(S.b, 'GST Certificate.pdf', PDF, { kind: 'GST_CERT' });
  assert.equal(pdf.status, 201, JSON.stringify(pdf.body));
  assert.equal(pdf.body.mimeType, 'application/pdf');
  assert.equal(pdf.body.fileName, 'GST_Certificate.pdf');
  assert.equal(pdf.body.scanStatus, 'NOT_SCANNED', 'no scanner configured — never claims CLEAN');
  S.bDoc = pdf.body.id;

  assert.equal((await upload(S.b, 'invoice.pdf', Buffer.from('MZ\x90\x00 fake exe'))).status, 400, 'executable disguised as PDF');
  assert.equal((await upload(S.b, 'page.html', Buffer.from('<html><script>alert(1)</script></html>'))).status, 400);
  assert.equal((await upload(S.b, 'data.csv', Buffer.from('a,b\n<script>x</script>'))).status, 400);
  const png = await upload(S.b, 'photo.jpg', PNG, { kind: 'LISTING_ASSETS' });
  assert.equal(png.body.mimeType, 'image/png', 'type comes from content, not name');
  assert.equal(png.body.fileName, 'photo.png');
  const csv = await upload(S.b, 'stock.csv', Buffer.from('sku,qty\nJTR-1,12\n'));
  assert.equal(csv.body.mimeType, 'text/csv');
  assert.equal((await upload(S.b, 'big.pdf', Buffer.concat([PDF, Buffer.alloc(1.2 * 1024 * 1024)]))).status, 413);

  const dl = await fetch(`${base}/documents/${S.bDoc}/download`, { headers: { authorization: `Bearer ${S.b}` } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="GST_Certificate.pdf"/);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(Buffer.from(await dl.arrayBuffer()).equals(PDF), 'bytes round-trip intact');

  assert.equal((await fetch(`${base}/documents/${S.bDoc}/download`, { headers: { authorization: `Bearer ${S.c}` } })).status, 404, 'other tenant cannot download');
  assert.ok(!ok(await call('GET', '/documents', { token: S.c })).some((d) => d.id === S.bDoc));
  assert.equal((await upload(S.b, 'note.txt', Buffer.from('hello'), { visibility: 'INTERNAL' })).status, 403);

  S.ops = await staff('OPERATIONS_MANAGER', S.admin);
  const bOrg = (await db.user.findFirst({ where: { organization: { documents: { some: { id: S.bDoc } } } } })).organizationId;
  S.bOrg = bOrg;
  const internal = await upload(S.ops.token, 'margin-notes.txt', Buffer.from('internal margin notes'), { visibility: 'INTERNAL', organizationId: bOrg, kind: 'OTHER' });
  assert.equal(internal.status, 201);
  S.bInternalDoc = internal.body.id;
  assert.ok(!ok(await call('GET', '/documents', { token: S.b })).some((d) => d.id === internal.body.id), 'client never sees INTERNAL documents');
  assert.equal((await fetch(`${base}/documents/${internal.body.id}/download`, { headers: { authorization: `Bearer ${S.b}` } })).status, 404);
  assert.ok(ok(await call('GET', `/documents?organizationId=${bOrg}`, { token: S.ops.token })).some((d) => d.id === internal.body.id));

  await fetch(`${base}/documents/${S.bDoc}/download`, { headers: { authorization: `Bearer ${S.ops.token}` } });
  assert.ok(await db.auditLog.findFirst({ where: { action: 'document.staff_download', entityId: S.bDoc } }), 'staff access to client files is audited');

  ok(await call('DELETE', `/documents/${csv.body.id}`, { token: S.b }));
  assert.ok(!ok(await call('GET', '/documents', { token: S.b })).some((d) => d.id === csv.body.id));
});

test('chat: auto-assigned manager, live delivery both ways, internal notes stay internal, read receipts, search', async () => {
  S.sup1 = await staff('SUPPORT_EXECUTIVE', S.admin);
  // Make sup1 the least-loaded candidate, then register a new client → auto-assigned (onboarding step 7).
  await db.managerAssignment.deleteMany({});
  S.d = await registerCustomer('Devika');
  const before = ok(await call('GET', '/chat', { token: S.d }));
  S.dOrg = before.organizationId;
  assert.equal(before.managers.length, 0, 'no manager until a plan starts');
  // A paying client gets the least-loaded manager and a welcome for their plan.
  const esha = await registerCustomer('Esha');
  await pay(esha, 'GROWTH');
  const eHist = ok(await call('GET', '/chat', { token: esha }));
  assert.equal(eHist.managers.length, 1, 'a manager is assigned when the plan starts');
  const eManager = eHist.managers[0];
  const hello = eHist.messages.filter((m) => m.senderType === 'STAFF' && m.sender.id === eManager.id).map((m) => m.body);
  assert.equal(hello.length, 3, 'the manager says hello in a few short messages');
  assert.match(hello[0], /^Hi Esha! I'm \S+ from SOLLUNA/);
  assert.match(hello[1], /Growth plan is all set/);
  assert.match(hello[2], /ads plan/);
  assert.ok(hello.every((b) => b.length <= 140), 'chat-length messages, no benefit dumps');
  assert.ok(await db.notification.findFirst({ where: { userId: eManager.id, type: 'manager.new_client' } }), 'manager told about the new client');
  assert.ok(await db.notification.findFirst({ where: { organizationId: eHist.organizationId, type: 'manager.pending', body: { contains: 'within 1 hour' } } }), 'client promised a manager within 1 hour');
  assert.equal(eHist.managerPending, null, 'nothing pending once the manager has written');
  await pay(esha, 'GROWTH');
  await pay(esha, 'PREMIUM');
  const after = ok(await call('GET', '/chat', { token: esha })).messages.filter((m) => m.senderType === 'STAFF');
  assert.equal(after.length, 5, 'renewal sends nothing; plan change sends a short note');
  assert.match(after[3].body, /moved to Premium/);
  assert.equal(after[3].sender.id, eManager.id, 'same manager after a plan change');
  // Queued hand-off: client sees the 1-hour promise; nothing is sent before it is due.
  const fay = await registerCustomer('Fay');
  const fayOrg = ok(await call('GET', '/chat', { token: fay })).organizationId;
  await db.managerWelcome.create({ data: { organizationId: fayOrg, planCode: 'RESELLER', kind: 'NEW', dueAt: new Date(Date.now() + 3_600_000) } });
  const fayChat = ok(await call('GET', '/chat', { token: fay }));
  assert.ok(fayChat.managerPending?.assignBy, 'pending hand-off is visible to the client');
  assert.equal(fayChat.managers.length + fayChat.messages.length, 0, 'no manager or message before it is due');
  await db.managerWelcome.update({ where: { organizationId: fayOrg }, data: { dueAt: new Date(Date.now() - 1000) } });
  const fayLater = ok(await call('GET', '/chat', { token: fay }));
  assert.equal(fayLater.managers.length, 1, 'due hand-off runs when the client opens chat');
  assert.equal(fayLater.messages.length, 3);
  assert.equal((await call('POST', '/billing/preview-activate', { token: esha, body: { planCode: 'RESELLER' } })).status, 404, 'test activation exists only in preview environments');
  ok(await call('POST', `/admin/clients/${S.dOrg}/managers`, { token: S.admin, body: { managerId: S.sup1.id } }));
  const dHist = ok(await call('GET', '/chat', { token: S.d }));
  const assigned = dHist.managers[0];
  assert.ok(['SUPPORT_EXECUTIVE', 'OPERATIONS_MANAGER'].includes(assigned.staffRole));
  if (assigned.id !== S.sup1.id) ok(await call('POST', `/admin/clients/${S.dOrg}/managers`, { token: S.admin, body: { managerId: S.sup1.id } }));

  const clientStream = await openStream(S.d, '/chat/stream');
  const staffStream = await openStream(S.sup1.token, '/ops/chats/stream');
  assert.equal(clientStream.status, 200);
  assert.match(clientStream.contentType, /text\/event-stream/);
  await new Promise((r) => setTimeout(r, 150));

  const att = await upload(S.d, 'brand-authorization.pdf', PDF, { kind: 'BRAND_AUTH' });
  const sent = ok(await call('POST', '/chat/messages', { token: S.d, body: { body: 'Hi, our brand approval for Amazon got rejected. Letter attached.', documentIds: [att.body.id] } }));
  assert.equal(sent.attachments[0].id, att.body.id);
  const live = await waitFor(staffStream.events, (e) => e.type === 'message' && e.data.message.id === sent.id);
  assert.equal(live.data.message.senderType, 'CUSTOMER');
  assert.ok((await db.notification.findMany({ where: { userId: S.sup1.id, type: 'chat.client_message' } })).length >= 1, 'assigned manager notified');

  const inbox = ok(await call('GET', '/ops/chats', { token: S.sup1.token }));
  const row = inbox.find((r) => r.organizationId === S.dOrg);
  assert.equal(row.unread, 1);
  assert.equal(inbox[0].organizationId, S.dOrg, 'unanswered conversations first');

  // An unassigned support executive with no work for this client has no access.
  const sup2 = await staff('SUPPORT_EXECUTIVE', S.admin);
  assert.equal((await call('GET', `/ops/chats/${S.dOrg}`, { token: sup2.token })).status, 403);
  assert.ok(!ok(await call('GET', '/ops/chats', { token: sup2.token })).some((r) => r.organizationId === S.dOrg));

  const note = ok(await call('POST', `/ops/chats/${S.dOrg}/messages`, { token: S.sup1.token, body: { body: 'INTERNAL: check if they are an authorized reseller', internal: true } }));
  const reply = ok(await call('POST', `/ops/chats/${S.dOrg}/messages`, { token: S.sup1.token, body: { body: 'Thanks Devika — reviewing the letter now. Are you the brand owner or a reseller?' } }));
  await waitFor(clientStream.events, (e) => e.type === 'message' && e.data.message.id === reply.id);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!clientStream.events.some((e) => e.type === 'message' && e.data.message.id === note.id), 'internal note never streamed to the client');
  const clientView = ok(await call('GET', '/chat', { token: S.d })).messages;
  assert.ok(!clientView.some((m) => m.id === note.id), 'internal note never in client history');
  assert.ok(ok(await call('GET', `/ops/chats/${S.dOrg}`, { token: S.sup1.token })).messages.some((m) => m.id === note.id));
  assert.ok(ok(await call('GET', '/notifications', { token: S.d })).some((n) => n.type === 'chat.message'));
  assert.ok(connectorEvents.some((e) => e.body.type === 'chat.message' && e.body.organizationId === S.dOrg), 'reply goes to the connector (Zapier → Gmail)');
  assert.ok(!connectorEvents.some((e) => e.body.type === 'chat.message' && JSON.stringify(e.body).includes('INTERNAL:')), 'internal note never sent to the connector');

  ok(await call('POST', '/chat/read', { token: S.d }));
  await waitFor(staffStream.events, (e) => e.type === 'read' && e.data.by === 'CUSTOMER' && e.data.organizationId === S.dOrg);
  const staffView = ok(await call('GET', `/ops/chats/${S.dOrg}`, { token: S.sup1.token })).messages;
  assert.ok(staffView.find((m) => m.id === reply.id).readAt, 'client read receipt recorded');
  ok(await call('POST', `/ops/chats/${S.dOrg}/read`, { token: S.sup1.token }));
  assert.equal(ok(await call('GET', '/ops/chats', { token: S.sup1.token })).find((r) => r.organizationId === S.dOrg).unread, 0);

  const found = ok(await call('GET', '/chat?q=brand%20owner', { token: S.d })).messages;
  assert.deepEqual(found.map((m) => m.id), [reply.id]);

  // Attachments must belong to the sender's own org and upload.
  const foreign = await call('POST', '/chat/messages', { token: S.d, body: { body: 'x', documentIds: [S.bDoc] } });
  assert.equal(foreign.status, 400);
  assert.equal((await call('POST', '/chat/messages', { token: S.d, body: { body: 'x', internal: true } })).status, 400);
  clientStream.close(); staffStream.close();
});

test('chat → orchestrator: staff log a request from chat; plan entitlements still apply', async () => {
  const blocked = ok(await call('POST', `/ops/chats/${S.dOrg}/requests`, { token: S.sup1.token, body: { featureKey: 'BRAND_APPROVAL', title: 'Resolve Amazon brand approval rejection', marketplace: 'AMAZON' } }));
  assert.equal(blocked.request.entitlement, 'OUT_OF_PLAN', 'client without a plan stays blocked even when staff log it');
  const msgs = ok(await call('GET', '/chat', { token: S.d })).messages;
  assert.match(msgs[msgs.length - 1].body, /logged this as a request: "Resolve Amazon brand approval rejection"/);

  const queued = ok(await call('POST', `/ops/chats/${S.bOrg}/requests`, { token: S.ops.token, body: { featureKey: 'CATALOG_MAPPING', title: 'Map 30 steel bottle SKUs', marketplace: 'AMAZON' } }));
  assert.equal(queued.request.status, 'QUEUED');
  assert.equal(queued.request.organizationId, S.bOrg);

  // Deliverable shared through the client's Documents counts as evidence; internal files do not.
  const task = (await tasksOf(S.b, queued.request.id)).request.tasks[0];
  ok(await move(S.ops.token, task.id, 'IN_PROGRESS'));
  const ev = { summary: '30 SKUs matched to existing ASINs, mapping sheet shared', outcome: undefined };
  assert.equal((await move(S.ops.token, task.id, 'COMPLETED', { evidence: { ...ev, documentId: S.bInternalDoc } })).status, 400);
  const sheet = await upload(S.ops.token, 'mapping.csv', Buffer.from('sku,asin\nSB-1,B0TEST\n'), { organizationId: S.bOrg, kind: 'REPORT' });
  ok(await move(S.ops.token, task.id, 'COMPLETED', { evidence: { summary: ev.summary, documentId: sheet.body.id } }));
  assert.ok(ok(await call('GET', '/documents', { token: S.b })).some((d) => d.id === sheet.body.id), 'client can download the deliverable');
});

test('assignment: reassigning a client moves chat access to the new manager', async () => {
  const sup3 = await staff('SUPPORT_EXECUTIVE', S.admin);
  ok(await call('POST', `/admin/clients/${S.dOrg}/managers`, { token: S.ops.token, body: { managerId: sup3.id } }));
  ok(await call('GET', `/ops/chats/${S.dOrg}`, { token: sup3.token }));
  assert.equal((await call('GET', `/ops/chats/${S.dOrg}`, { token: S.sup1.token })).status, 403, 'previous manager loses access');
  const clients = ok(await call('GET', '/admin/clients', { token: S.ops.token }));
  assert.deepEqual(clients.find((c) => c.id === S.dOrg).managers.map((m) => m.id), [sup3.id]);
  assert.equal((await call('GET', '/admin/clients', { token: S.sup1.token })).status, 403);
});


// ───────────── monthly reporting ─────────────
const OCT = { salesBasis: 'SHIPPED', grossSalesPaise: 10_000_000, discountsPaise: 500_000, returnsRefundsPaise: 300_000, reimbursementsPaise: 100_000,
  orders: 90, unitsSold: 100, unitsReturned: 5, cancelledOrders: 10, sessions: 3000,
  commissionPaise: 1_500_000, fixedFeesPaise: 100_000, fulfilmentPaise: 300_000, shippingPaise: 100_000, storagePaise: 0, otherFeesPaise: 0,
  adSpendPaise: 300_000, adSalesPaise: 1_500_000, impressions: 50_000, clicks: 1_000, adSpendInFees: false,
  settlementPaise: 7_000_000, bankCreditPaise: 6_900_000, reservesPaise: 100_000, sourceNote: 'Amazon business report + settlement Oct 2026' };
const SKU = { lines: [
  { sku: 'SB-750', units: 60, netSalesPaise: 6_000_000, feesPaise: 1_200_000, adSpendPaise: 200_000 },
  { sku: 'SB-500', units: 40, netSalesPaise: 3_300_000, feesPaise: 800_000, adSpendPaise: 100_000 },
] };

test('reports: inputs → draft (hidden from client) → publish → client sees VERIFIED P&L, CSV, notification', async () => {
  S.acct = await staff('ACCOUNTS_EXECUTIVE', S.admin);
  const t = S.acct.token;
  assert.equal((await call('PUT', `/ops/reports/${S.bOrg}/2099-01/marketplaces/AMAZON`, { token: t, body: OCT })).status, 400, 'future period');
  assert.equal((await call('PUT', `/ops/reports/${S.bOrg}/2026-10/marketplaces/AMAZON`, { token: t, body: { ...OCT, grossSalesPaise: -5 } })).status, 400);
  ok(await call('PUT', `/ops/reports/${S.bOrg}/2026-10/marketplaces/AMAZON`, { token: t, body: OCT }));
  assert.equal((await call('PUT', `/ops/reports/${S.bOrg}/2026-10/marketplaces/AMAZON/sku-lines`, { token: t, body: { lines: [SKU.lines[0], SKU.lines[0]] } })).status, 400, 'duplicate SKU');
  ok(await call('PUT', `/ops/reports/${S.bOrg}/2026-10/marketplaces/AMAZON/sku-lines`, { token: t, body: SKU }));

  // Staff-entered cost is provisional; the client's own (newer) entry is authoritative.
  ok(await call('POST', `/ops/reports/${S.bOrg}/costs`, { token: t, body: { sku: 'SB-750', costPaise: 35_000, effectiveFrom: '2026-09-01' } }));
  let wb = ok(await call('GET', `/ops/reports/${S.bOrg}/2026-10`, { token: t }));
  assert.equal(wb.preview.pl.marketplaces[0].lines.cogs.conf, 'UNAVAILABLE', 'SB-500 has no cost yet');
  ok(await call('POST', '/costs', { token: S.b, body: { sku: 'SB-750', costPaise: 40_000, effectiveFrom: '2026-10-01' } }));
  ok(await call('POST', '/costs', { token: S.b, body: { sku: 'SB-500', costPaise: 30_000, effectiveFrom: '2026-10-01' } }));
  ok(await call('POST', '/costs', { token: S.b, body: { sku: 'SB-500', costPaise: 99_999, effectiveFrom: '2026-11-01' } })); // later month — must not apply to October
  const exp = ok(await call('POST', '/expenses', { token: S.b, body: { period: '2026-10', category: 'RENT', description: 'Warehouse rent', amountPaise: 1_000_000 } }));
  assert.equal((await call('POST', '/expenses/confirm', { token: S.acct.token, body: { period: '2026-10' } })).status, 403, 'only the client confirms expenses');
  ok(await call('POST', '/expenses/confirm', { token: S.b, body: { period: '2026-10' } }));
  assert.equal((await call('DELETE', `/expenses/${exp.id}`, { token: S.b })).status, 400, 'confirmed months are locked');

  const draft = ok(await call('POST', `/ops/reports/${S.bOrg}/2026-10/generate`, { token: t, body: { kind: 'PL' } }));
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.confidence, 'VERIFIED');
  assert.equal(draft.data.marketplaces[0].lines.cogs.paise, 3_600_000, 'October costs used, not the November one');
  assert.equal(draft.data.operatingResult.paise, 2_400_000);
  assert.equal((await call('GET', `/reports/${draft.id}`, { token: S.b })).status, 404, 'clients never see drafts');
  assert.equal(ok(await call('GET', '/reports', { token: S.b })).length, 0);

  ok(await call('POST', `/ops/reports/drafts/${draft.id}/publish`, { token: t }));
  assert.equal((await call('POST', `/ops/reports/drafts/${draft.id}/publish`, { token: t })).status, 400, 'publish once');
  const mine = ok(await call('GET', `/reports/${draft.id}`, { token: S.b }));
  assert.equal(mine.periodLabel, 'October 2026');
  assert.equal(mine.data.reconciliation.status, 'RECONCILED');
  assert.ok(ok(await call('GET', '/notifications', { token: S.b })).some((n) => n.type === 'report.published' && /October 2026 P&L report is ready/.test(n.title)));
  assert.ok(connectorEvents.some((e) => e.body.type === 'report.published'));
  S.bPl = draft.id;

  const csv = await fetch(`${base}/reports/${draft.id}/export.csv`, { headers: { authorization: `Bearer ${S.b}` } });
  assert.match(csv.headers.get('content-disposition'), /SOLLUNA_PL_2026-10_v1\.csv/);
  const bytes = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM so Excel reads ₹ and Indian names correctly');
  const text = bytes.toString('utf8');
  assert.match(text, /CONSOLIDATED,Operating result,24000\.00,VERIFIED/);
  assert.match(text, /AMAZON,SB-750,60,60000\.00,24000\.00,12000\.00,2000\.00,22000\.00/);

  assert.equal((await call('GET', `/reports/${draft.id}`, { token: S.c })).status, 404, 'other tenants cannot read it');
  assert.equal((await call('GET', `/ops/reports/${S.bOrg}/2026-10`, { token: S.lister.token })).status, 401, 'deactivated earlier');
  const lister2 = await staff('LISTING_EXECUTIVE', S.admin);
  assert.equal((await call('GET', `/ops/reports/${S.bOrg}/2026-10`, { token: lister2.token })).status, 403, 'listing team has no reporting access');
});

test('reports: incomplete data is disclosed — estimated/unavailable, never shown as verified profit', async () => {
  const t = S.acct.token;
  ok(await call('PUT', `/ops/reports/${S.bOrg}/2026-09/marketplaces/AMAZON`, { token: t, body: { ...OCT, bankCreditPaise: null, adSpendPaise: null, adSalesPaise: null } }));
  ok(await call('PUT', `/ops/reports/${S.bOrg}/2026-09/marketplaces/FLIPKART`, { token: t, body: { salesBasis: 'SHIPPED', grossSalesPaise: 2_000_000, commissionPaise: 400_000 } }));
  ok(await call('PUT', `/ops/reports/${S.bOrg}/2026-09/marketplaces/AMAZON/sku-lines`, { token: t, body: SKU }));
  const r = ok(await call('POST', `/ops/reports/${S.bOrg}/2026-09/generate`, { token: t, body: { kind: 'PL' } }));
  assert.equal(r.confidence, 'UNAVAILABLE', 'SB-500 had no October-or-earlier cost in September… and Flipkart has no SKU lines');
  assert.equal(r.data.consolidated.cogs.paise, null);
  assert.equal(r.data.operatingResult.paise, null);
  assert.equal(r.data.reconciliation.status, 'PENDING_SOURCE_DATA');
  assert.ok(r.data.assumptions.some((a) => /advertising/.test(a.item)));
  assert.ok(r.data.assumptions.some((a) => a.item === 'Operating expenses' && a.owner === 'Client'));
  const perf = ok(await call('POST', `/ops/reports/${S.bOrg}/2026-09/generate`, { token: t, body: { kind: 'PERFORMANCE' } }));
  assert.equal(perf.data.marketplaces.length, 2);
  // October performance has a September baseline now.
  const octPerf = ok(await call('POST', `/ops/reports/${S.bOrg}/2026-10/generate`, { token: t, body: { kind: 'PERFORMANCE' } }));
  assert.equal(octPerf.data.marketplaces.find((m) => m.marketplace === 'AMAZON').momGrossSalesPct, 0);
  S.bPerfOct = octPerf.id;

  // Clients without the entitlement cannot have reports generated.
  ok(await call('PUT', `/ops/reports/${S.dOrg}/2026-10/marketplaces/AMAZON`, { token: S.ops.token, body: OCT }));
  assert.equal((await call('POST', `/ops/reports/${S.dOrg}/2026-10/generate`, { token: S.ops.token, body: { kind: 'PL' } })).status, 403);
});

test('CA pack: index from the client\'s documents, missing tracker, CA review flags, disclaimer', async () => {
  let pack = ok(await call('GET', '/ca-pack?period=2026-10', { token: S.b }));
  assert.deepEqual(pack.marketplaces, ['AMAZON'], 'only marketplaces with activity that month');
  assert.ok(pack.missing.some((m) => m.required === 'Amazon settlement report'));
  assert.ok(!pack.missing.some((m) => /Flipkart/.test(m.required)));
  assert.ok(pack.index.some((i) => /Monthly marketplace P&L/.test(i.document)), 'published P&L included');
  assert.match(pack.disclaimer, /Tax filing, audit and certification are not included/);
  assert.equal(pack.complete, false);

  const settle = await upload(S.b, 'amazon-settlement-oct.csv', Buffer.from('settlement_id,amount\nS1,70000\n'), { kind: 'AMAZON_SETTLEMENT', period: '2026-10' });
  assert.equal(settle.status, 201);
  const fee = await upload(S.b, 'amazon-fee-invoice.pdf', PDF, { kind: 'AMAZON_FEE_INVOICE', period: '2026-10' });
  await upload(S.b, 'september-settlement.pdf', PDF, { kind: 'AMAZON_SETTLEMENT', period: '2026-09' }); // other month — not in October's pack
  ok(await call('PATCH', `/ops/documents/${fee.body.id}/ca`, { token: S.acct.token, body: { caStatus: 'CA_REVIEW_REQUIRED' } }));

  pack = ok(await call('GET', '/ca-pack?period=2026-10', { token: S.b }));
  const rows = pack.index.filter((i) => i.category !== 'Reconciliation schedules');
  assert.deepEqual(rows.map((i) => [i.source, i.status]), [['Amazon settlement report', 'Received'], ['Amazon fee / tax invoices', 'CA review required']]);
  assert.equal(pack.caQuestions.length, 1);
  assert.ok(!pack.missing.some((m) => m.required === 'Amazon settlement report'));
  assert.ok(pack.missing.some((m) => m.required === 'Bank statement / payment credits'));
  assert.equal((await call('GET', '/ca-pack?period=2026-10', { token: S.d })).status, 403, 'needs an active plan with CA documentation');
});

test('orchestrator: monthly reporting workflow completes only with published reports of the right kind', async () => {
  const req = ok(await call('POST', '/requests', { token: S.b, body: { featureKey: 'MONTHLY_PL_REPORT', title: 'October reports', details: { includeCaPack: true } } }));
  let r = await tasksOf(S.b, req.request.id);
  assert.deepEqual(r.request.tasks.map((x) => x.stepKey), ['performance', 'pl', 'ca-pack']);
  const perfTask = step(r, 'performance').id;
  ok(await move(S.acct.token, perfTask, 'IN_PROGRESS'));
  assert.equal((await move(S.acct.token, perfTask, 'COMPLETED', { evidence: { summary: 'October performance report published', reportId: S.bPl } })).status, 400, 'a P&L is not a performance report');
  assert.equal((await move(S.acct.token, perfTask, 'COMPLETED', { evidence: { summary: 'October performance report published', reportId: S.bPerfOct } })).status, 400, 'draft not accepted');
  ok(await call('POST', `/ops/reports/drafts/${S.bPerfOct}/publish`, { token: S.acct.token }));
  ok(await move(S.acct.token, perfTask, 'COMPLETED', { evidence: { summary: 'October performance report published', reportId: S.bPerfOct } }));
  r = await tasksOf(S.b, req.request.id);
  ok(await complete(S.acct.token, step(r, 'pl').id, { summary: 'October P&L v1 published, VERIFIED', reportId: S.bPl }));
  r = await tasksOf(S.b, req.request.id);
  assert.equal(step(r, 'ca-pack').status, 'QUEUED');
});

// ───────────── Full-platform modules ─────────────
const sinkOf = (type) => connectorEvents.filter((e) => e.body.type === type);
const tokenFrom = (link) => new URL(link).searchParams.get('token');

test('account: email verification, password reset (single use, ends old sessions), change password, profile', async () => {
  const t = await registerCustomer('Ekta');
  const me = ok(await call('GET', '/auth/me', { token: t }));
  assert.equal(me.user.emailVerified, false);
  const verifyMail = sinkOf('auth.verify_email').find((e) => e.body.to === me.user.email);
  assert.ok(verifyMail, 'verification email sent through the connector');
  ok(await call('POST', '/auth/email/verify', { body: { token: tokenFrom(verifyMail.body.link) } }));
  assert.equal((await call('POST', '/auth/email/verify', { body: { token: tokenFrom(verifyMail.body.link) } })).status, 400, 'single use');
  assert.equal(ok(await call('GET', '/auth/me', { token: t })).user.emailVerified, true);

  // Unknown email gets the same answer (no enumeration) and no email.
  const before = sinkOf('auth.password_reset').length;
  const unknown = ok(await call('POST', '/auth/password/forgot', { body: { email: 'nobody@nowhere.test' } }));
  assert.equal(unknown.ok, true);
  assert.equal(unknown.devLink, undefined, 'links never returned when a connector delivers them');
  assert.equal(sinkOf('auth.password_reset').length, before);
  ok(await call('POST', '/auth/password/forgot', { body: { email: me.user.email } }));
  const reset = sinkOf('auth.password_reset').at(-1);
  assert.equal(reset.body.to, me.user.email);
  assert.ok(reset.signature, 'connector payload is signed');
  const token = tokenFrom(reset.body.link);
  assert.equal((await db.authToken.findFirst({ where: { purpose: 'RESET_PASSWORD' }, orderBy: { createdAt: 'desc' } })).tokenHash.length, 64, 'only a hash is stored');
  assert.equal((await call('POST', '/auth/password/reset', { body: { token, password: 'short' } })).status, 400);
  await new Promise((r) => setTimeout(r, 1100)); // old session must be strictly older than the reset
  ok(await call('POST', '/auth/password/reset', { body: { token, password: 'Brand-New-Pass-1' } }));
  assert.equal((await call('POST', '/auth/password/reset', { body: { token, password: 'Another-Pass-12' } })).status, 400, 'reset links are single use');
  assert.equal((await call('GET', '/auth/me', { token: t })).status, 401, 'sessions from before the reset are ended');
  assert.equal((await call('POST', '/auth/login', { body: { email: me.user.email, password: 'Seller-Pass-123' } })).status, 401);
  let t2 = await login(me.user.email, 'Brand-New-Pass-1');

  assert.equal((await call('POST', '/auth/password/change', { token: t2, body: { currentPassword: 'wrong', newPassword: 'Changed-Pass-123' } })).status, 400);
  await new Promise((r) => setTimeout(r, 1100));
  const changed = ok(await call('POST', '/auth/password/change', { token: t2, body: { currentPassword: 'Brand-New-Pass-1', newPassword: 'Changed-Pass-123' } }));
  assert.equal((await call('GET', '/auth/me', { token: t2 })).status, 401, 'other sessions end on password change');
  ok(await call('GET', '/auth/me', { token: changed.token })); // this session continues with a fresh token
  t2 = changed.token;

  ok(await call('PATCH', '/auth/profile', { token: t2, body: { name: 'Ekta Shah' } }));
  assert.equal((await call('PATCH', '/auth/profile', { token: t2, body: { email: 'take@over.test' } })).status, 400, 'email cannot be changed via profile');
  assert.equal((await call('PATCH', '/account/organization', { token: t2, body: { pan: 'BADPAN' } })).status, 400);
  const org = ok(await call('PATCH', '/account/organization', { token: t2, body: { category: 'Home & Kitchen', pan: 'ABCDE1234F', brandName: 'Ekta Home' } }));
  assert.equal(org.pan, 'ABCDE1234F');
  assert.ok(await db.auditLog.findFirst({ where: { action: 'auth.password_reset' } }));
  S.e = t2;
});

test('tickets: client raises → staff notified → status lifecycle with notes → client sees only public thread → close/reopen', async () => {
  const support = await staff('SUPPORT_EXECUTIVE', S.admin);
  assert.equal((await call('POST', '/tickets', { token: S.b, body: { category: 'NOPE', subject: 'x', description: 'y' } })).status, 400);
  const tk = ok(await call('POST', '/tickets', { token: S.b, body: { category: 'SHIPPING_LABELS', marketplace: 'AMAZON', subject: 'Labels missing for 3 orders', description: 'Orders 402-111, 402-112, 402-113 have no labels today.', priority: 'P2' } }));
  assert.equal(tk.status, 'NEW');
  assert.equal(new Date(tk.ackDueAt) - new Date(tk.createdAt), 2 * 3600_000, 'P2 = 2h acknowledgement');
  assert.ok(await db.notification.findFirst({ where: { userId: support.id, type: 'ticket.created' } }), 'support team notified');
  const queue = ok(await call('GET', '/ops/tickets', { token: support.token }));
  assert.ok(queue.some((q) => q.id === tk.id));
  assert.equal((await call('GET', `/tickets/${tk.id}`, { token: S.c })).status, 404, 'other tenants cannot see it');
  assert.equal((await call('GET', '/ops/tickets', { token: S.b })).status, 403);

  assert.equal((await call('PATCH', `/ops/tickets/${tk.id}`, { token: support.token, body: { status: 'CLOSED' } })).status, 200, 'NEW can be closed (e.g. duplicate)');
  ok(await call('PATCH', `/ops/tickets/${tk.id}`, { token: support.token, body: { status: 'IN_PROGRESS' } }));
  ok(await call('PATCH', `/ops/tickets/${tk.id}`, { token: support.token, body: { assigneeId: support.id } }));
  assert.equal((await call('PATCH', `/ops/tickets/${tk.id}`, { token: support.token, body: { status: 'WAITING_FOR_CLIENT' } })).status, 400, 'must say what is needed');
  ok(await call('PATCH', `/ops/tickets/${tk.id}`, { token: support.token, body: { status: 'WAITING_FOR_CLIENT', note: 'Please confirm the orders are not cancelled.' } }));
  ok(await call('POST', `/ops/tickets/${tk.id}/comments`, { token: support.token, body: { body: 'Internal: Seller Central shows 402-113 cancelled.', internal: true } }));
  assert.equal((await call('POST', `/tickets/${tk.id}/comments`, { token: S.b, body: { body: 'x', internal: true } })).status, 403);
  ok(await call('POST', `/tickets/${tk.id}/comments`, { token: S.b, body: { body: 'Confirmed — none cancelled.' } }));
  let view = ok(await call('GET', `/tickets/${tk.id}`, { token: S.b }));
  assert.equal(view.status, 'IN_PROGRESS', 'client reply moves it back to SOLLUNA');
  assert.ok(!view.comments.some((c) => c.internal || c.body.startsWith('Internal')), 'internal notes hidden from client');
  assert.ok(ok(await call('GET', `/ops/tickets/${tk.id}`, { token: support.token })).comments.some((c) => c.internal));
  assert.equal((await call('POST', `/tickets/${tk.id}/action`, { token: S.b, body: { action: 'CLOSE' } })).status, 400, 'only resolved tickets can be closed by client');
  assert.equal((await call('PATCH', `/ops/tickets/${tk.id}`, { token: support.token, body: { status: 'RESOLVED' } })).status, 400, 'resolution note required');
  ok(await call('PATCH', `/ops/tickets/${tk.id}`, { token: support.token, body: { status: 'RESOLVED', note: 'Labels regenerated and shared in today’s batch.' } }));
  view = ok(await call('POST', `/tickets/${tk.id}/action`, { token: S.b, body: { action: 'REOPEN', note: 'One label still blank' } }));
  assert.equal(view.status, 'IN_PROGRESS');
  ok(await call('PATCH', `/ops/tickets/${tk.id}`, { token: support.token, body: { status: 'RESOLVED', note: 'Fixed the blank label.' } }));
  view = ok(await call('POST', `/tickets/${tk.id}/action`, { token: S.b, body: { action: 'CLOSE' } }));
  assert.equal(view.status, 'CLOSED');
  assert.ok(view.firstResponseAt);
  const notes = ok(await call('GET', '/notifications', { token: S.b })).filter((n) => n.type === 'ticket.status_changed');
  assert.ok(notes.length >= 4, 'client notified on every status change');
  assert.ok(ok(await call('GET', '/notifications/unread-count', { token: S.b })).count > 0);
  ok(await call('POST', '/notifications/read-all', { token: S.b }));
  assert.equal(ok(await call('GET', '/notifications/unread-count', { token: S.b })).count, 0);
});

test('onboarding + marketplaces: checklist, no passwords accepted, CONNECTED only with staff evidence', async () => {
  let ob = ok(await call('GET', '/onboarding', { token: S.b }));
  assert.equal(ob.steps.find((s) => s.key === 'PLAN').done, true);
  assert.equal(ob.steps.find((s) => s.key === 'MARKETPLACES').done, false);
  assert.equal((await call('PUT', '/marketplaces/AMAZON', { token: S.b, body: { hasAccount: true, storeName: 'Bharat Store', password: 'hunter2' } })).status, 400, 'passwords are rejected outright');
  assert.equal((await call('PUT', '/marketplaces/AMAZON', { token: S.b, body: { hasAccount: true } })).status, 400);
  const acct = ok(await call('PUT', '/marketplaces/AMAZON', { token: S.b, body: { hasAccount: true, storeName: 'Bharat Store', sellerId: 'A1B2C3D4E5', contactEmail: 'seller@bharat.test' } }));
  assert.equal(acct.status, 'PENDING', 'clients cannot self-certify a connection');
  ok(await call('PUT', '/marketplaces/FLIPKART', { token: S.b, body: { hasAccount: false } }));
  assert.equal((await call('PATCH', `/ops/clients/${S.bOrg}/marketplaces/AMAZON`, { token: S.ops.token, body: { status: 'CONNECTED' } })).status, 400, 'evidence required');
  assert.equal((await call('PATCH', `/ops/clients/${S.bOrg}/marketplaces/AMAZON`, { token: S.ads.token, body: { status: 'CONNECTED', note: 'User permission accepted in Seller Central' } })).status, 403, 'ads role cannot verify accounts');
  ok(await call('PATCH', `/ops/clients/${S.bOrg}/marketplaces/AMAZON`, { token: S.ops.token, body: { status: 'CONNECTED', note: 'User permission accepted in Seller Central on 6 Nov' } }));
  const mps = ok(await call('GET', '/marketplaces', { token: S.b }));
  assert.equal(mps.find((m) => m.marketplace === 'AMAZON').status, 'CONNECTED');
  assert.equal(mps.find((m) => m.marketplace === 'FLIPKART').hasAccount, false);
  // Changing the seller identity resets verification.
  const changed = ok(await call('PUT', '/marketplaces/AMAZON', { token: S.b, body: { hasAccount: true, storeName: 'Bharat Store 2', sellerId: 'Z9Y8X7W6V5' } }));
  assert.equal(changed.status, 'PENDING');
  ob = ok(await call('GET', '/onboarding', { token: S.b }));
  assert.equal(ob.steps.find((s) => s.key === 'MARKETPLACES').done, true);
  if (!ob.steps.find((s) => s.key === 'MANAGER').done) {
    ok(await call('POST', `/admin/clients/${S.bOrg}/managers`, { token: S.admin, body: { managerId: S.ops.id } }));
    ob = ok(await call('GET', '/onboarding', { token: S.b }));
  }
  assert.equal(ob.steps.find((s) => s.key === 'MANAGER').done, true);
  assert.equal(ob.complete, false, 'email not verified and no GST/PAN document yet');
});

test('products + listings: validated product, plan/quota via orchestrator, per-marketplace tracking, marketplace evidence for LIVE', async () => {
  assert.equal((await call('POST', '/products', { token: S.b, body: { name: 'Brass Diya', mrp: 500, sellingPrice: 600 } })).status, 400, 'selling price above MRP rejected');
  const p = ok(await call('POST', '/products', { token: S.b, body: { name: 'Brass Diya Set of 4', sku: 'BD-4', category: 'Home Decor', mrp: 999, sellingPrice: 749, gstRate: 12 } }));
  assert.equal(p.mrpPaise, 99900);
  assert.equal((await call('POST', '/products', { token: S.b, body: { name: 'Dup', sku: 'BD-4' } })).status, 400, 'duplicate SKU');
  assert.equal((await call('POST', '/listings', { token: S.b, body: { productId: p.id, marketplaces: ['AMAZON'] } })).status, 400, 'brand + HSN required first');
  ok(await call('PATCH', `/products/${p.id}`, { token: S.b, body: { name: 'Brass Diya Set of 4', sku: 'BD-4', brand: 'Bharat', hsn: '7418', category: 'Home Decor', mrp: 999, sellingPrice: 749, gstRate: 12 } }));
  const sub = ok(await call('POST', '/listings', { token: S.b, body: { productId: p.id, marketplaces: ['AMAZON', 'FLIPKART'] } }));
  assert.equal(sub.results.length, 2);
  assert.ok(sub.results.every((r) => r.created), JSON.stringify(sub.results));
  const again = ok(await call('POST', '/listings', { token: S.b, body: { productId: p.id, marketplaces: ['AMAZON'] } }));
  assert.equal(again.results[0].created, false, 'no duplicate listing per product + marketplace');
  const listings = ok(await call('GET', '/listings', { token: S.b }));
  const amz = listings.find((l) => l.marketplace === 'AMAZON' && l.productId === p.id);
  const fk = listings.find((l) => l.marketplace === 'FLIPKART' && l.productId === p.id);
  assert.ok(amz.serviceRequestId && fk.serviceRequestId, 'each listing is an orchestrator request (plan + quota checked)');
  assert.equal((await call('PATCH', `/ops/listings/${amz.id}`, { token: S.lister.token, body: { status: 'ACTIVE' } })).status.toString().startsWith('4'), true);
  assert.equal((await call('PATCH', `/ops/listings/${amz.id}`, { token: S.ops.token, body: { status: 'ACTIVE', catalogId: 'B0CXYZ1234' } })).status, 400, 'live needs the marketplace URL');
  assert.equal((await call('PATCH', `/ops/listings/${amz.id}`, { token: S.ops.token, body: { status: 'CATALOG_ID_CREATED' } })).status, 400, 'needs the ASIN');
  assert.equal((await call('PATCH', `/ops/listings/${amz.id}`, { token: S.ops.token, body: { status: 'ACTIVE', catalogId: 'B0CXYZ1234', liveUrl: 'https://evil.example.com/dp/B0CXYZ1234' } })).status, 400, 'only marketplace URLs');
  ok(await call('PATCH', `/ops/listings/${amz.id}`, { token: S.ops.token, body: { status: 'CONTENT_IN_PROGRESS', note: 'Drafting title and bullets' } }));
  const live = ok(await call('PATCH', `/ops/listings/${amz.id}`, { token: S.ops.token, body: { status: 'ACTIVE', catalogId: 'B0CXYZ1234', liveUrl: 'https://www.amazon.in/dp/B0CXYZ1234' } }));
  assert.equal(live.status, 'ACTIVE');
  assert.equal((await db.product.findUnique({ where: { id: p.id } })).asin, 'B0CXYZ1234');
  assert.equal((await call('PATCH', `/ops/listings/${fk.id}`, { token: S.ops.token, body: { status: 'REJECTED' } })).status, 400, 'rejection needs a reason');
  ok(await call('PATCH', `/ops/listings/${fk.id}`, { token: S.ops.token, body: { status: 'REJECTED', note: 'Flipkart needs brand approval first' } }));
  const after = ok(await call('GET', '/listings', { token: S.b }));
  assert.equal(after.find((l) => l.id === amz.id).status, 'ACTIVE');
  assert.equal(after.find((l) => l.id === fk.id).status, 'REJECTED', 'marketplaces tracked separately');
  assert.ok(after.find((l) => l.id === amz.id).history.length >= 3);
  assert.equal((await call('GET', '/listings', { token: S.c })).body.some?.((l) => l.id === amz.id), false, 'tenant isolation');
  assert.ok(ok(await call('GET', '/notifications', { token: S.b })).some((n) => n.type === 'listing.status_changed' && n.body.includes('amazon.in')));
});

test('quota via listings: Reseller limit of 3 per marketplace per month blocks the 4th listing', async () => {
  const r = await registerCustomer('Farhan');
  await pay(r, 'RESELLER');
  const results = [];
  for (let i = 1; i <= 4; i++) {
    const p = ok(await call('POST', '/products', { token: r, body: { name: `Steel Bottle ${i}`, sku: `SB-${i}`, brand: 'Farhan', category: 'Kitchen', hsn: '7323', mrp: 499, sellingPrice: 399 } }));
    results.push(ok(await call('POST', '/listings', { token: r, body: { productId: p.id, marketplaces: ['AMAZON'] } })).results[0]);
  }
  assert.deepEqual(results.map((x) => x.created), [true, true, true, false]);
  assert.match(results[3].reason, /limit/i);
  assert.equal(ok(await call('GET', '/listings', { token: r })).length, 3);
  S.reseller = r;
});

test('catalog mapping: client submits identifiers, staff record confidence results with evidence, client notified', async () => {
  const sub = ok(await call('POST', '/mappings', { token: S.b, body: { marketplace: 'AMAZON', items: [{ identifier: 'B07ABC1234', sellerSku: 'LAMP-1' }, { identifier: 'Brass Lamp 12 inch', sellerSku: 'LAMP-2' }] } }));
  assert.equal(sub.created, 2);
  const rows = ok(await call('GET', '/mappings', { token: S.b })).filter((m) => m.serviceRequestId === sub.requestId);
  assert.equal((await call('PATCH', `/ops/mappings/${rows[0].id}`, { token: S.ops.token, body: { status: 'EXACT_VERIFIED' } })).status, 400, 'match needs the ASIN');
  ok(await call('PATCH', `/ops/mappings/${rows[0].id}`, { token: S.ops.token, body: { status: 'EXACT_VERIFIED', candidateId: 'B07ABC1234' } }));
  assert.equal((await call('PATCH', `/ops/mappings/${rows[1].id}`, { token: S.ops.token, body: { status: 'NO_MATCH_FOUND' } })).status, 400, 'explanation needed');
  ok(await call('PATCH', `/ops/mappings/${rows[1].id}`, { token: S.ops.token, body: { status: 'NO_MATCH_FOUND', note: 'No existing ASIN — needs a new listing' } }));
  assert.ok(ok(await call('GET', '/notifications', { token: S.b })).some((n) => n.type === 'mapping.updated'));
});

test('labels: Growth gets official labels (unaltered, delivered on download); Reseller blocked; Premium adds approved thank-you inserts', async () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const upload = (token, orgId, fields, buf = pdf, name = 'labels.pdf') => {
    const fd = new FormData();
    fd.append('file', new Blob([buf]), name);
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    return fetch(`${base}/ops/clients/${orgId}/labels`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd }).then(async (r) => ({ status: r.status, body: await r.json() }));
  };
  const fields = { marketplace: 'AMAZON', batchDate: '2026-11-06', orderCount: 12, dispatchBy: '2026-11-06T13:00:00+05:30' };
  const resellerOrg = ok(await call('GET', '/auth/me', { token: S.reseller })).organization.id;
  assert.equal((await upload(S.ops.token, resellerOrg, fields)).status, 403, 'labels are Growth+');
  assert.equal((await upload(S.ops.token, S.bOrg, fields, Buffer.from('not a pdf at all'), 'labels.pdf')).status, 400);
  const job = ok(await upload(S.ops.token, S.bOrg, { ...fields, skippedOrders: '402-999 cancelled' }));
  assert.equal(job.status, 'READY');
  assert.equal(job.noteCount, 0, 'no thank-you notes below Premium');
  const list = ok(await call('GET', '/labels', { token: S.b }));
  assert.ok(list.some((j) => j.id === job.id));
  const dl = await fetch(`${base}/labels/${job.id}/download`, { headers: { authorization: `Bearer ${S.b}` } });
  assert.equal(dl.status, 200);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), pdf, 'official label delivered byte-for-byte unaltered');
  assert.equal((await db.labelJob.findUnique({ where: { id: job.id } })).status, 'DELIVERED');
  assert.equal((await fetch(`${base}/labels/${job.id}/download`, { headers: { authorization: `Bearer ${S.c}` } })).status, 404, 'other clients cannot download');
  assert.ok(ok(await call('GET', '/notifications', { token: S.b })).some((n) => n.type === 'labels.ready'));

  // Premium: thank-you design → compliance check → client approval → inserts with the batch.
  const cOrg = ok(await call('GET', '/auth/me', { token: S.c })).organization.id;
  const design = { brandName: 'Chandra Living', message: 'Thank you for choosing Chandra Living. We hope it brightens your home.', supportContact: 'care@chandra.test', website: 'https://chandra.test', colors: { primary: '#C9962B', background: '#FFFFFF', text: '#12131C' }, widthMm: 100, heightMm: 150 };
  assert.equal((await call('POST', '/thank-you', { token: S.b, body: design })).status, 403, 'custom design is Premium only');
  assert.equal((await call('POST', '/thank-you', { token: S.c, body: { ...design, message: 'Leave us a 5-star review and get a free gift!' } })).status, 400, 'review incentives blocked');
  assert.equal((await call('POST', '/thank-you', { token: S.c, body: { ...design, message: 'Please leave a positive review on Amazon for us today.' } })).status, 400);
  const draft = ok(await call('POST', `/ops/clients/${cOrg}/thank-you`, { token: S.ops.token, body: design }));
  assert.equal(draft.status, 'DRAFT');
  assert.equal((await call('POST', `/thank-you/${draft.id}/decision`, { token: S.c, body: { decision: 'APPROVE' } })).status, 400, 'only designs sent for review can be approved');
  ok(await call('POST', `/ops/thank-you/${draft.id}/submit`, { token: S.ops.token }));
  assert.equal((await call('POST', `/thank-you/${draft.id}/decision`, { token: S.c, body: { decision: 'REQUEST_CHANGES' } })).status, 400, 'say what to change');
  ok(await call('POST', `/thank-you/${draft.id}/decision`, { token: S.c, body: { decision: 'REQUEST_CHANGES', note: 'Use our green' } }));
  ok(await call('PATCH', `/ops/clients/${cOrg}/thank-you/${draft.id}`, { token: S.ops.token, body: { ...design, colors: { ...design.colors, primary: '#2F6B4F' } } }));
  ok(await call('POST', `/ops/thank-you/${draft.id}/submit`, { token: S.ops.token }));
  const approved = ok(await call('POST', `/thank-you/${draft.id}/decision`, { token: S.c, body: { decision: 'APPROVE' } }));
  assert.equal(approved.status, 'APPROVED');
  const pjob = ok(await upload(S.ops.token, cOrg, { ...fields, orderCount: 5 }));
  assert.equal(pjob.noteCount, 5);
  const notes = ok(await call('GET', `/labels/${pjob.id}/notes`, { token: S.c }));
  assert.equal(notes.template.colors.primary, '#2F6B4F', 'the approved version is printed');
  assert.equal(notes.job.count, 5);
  // Editing an approved design creates v2 that needs approval; batches keep using v1.
  const v2 = ok(await call('PATCH', `/thank-you/${draft.id}`, { token: S.c, body: { ...design, message: 'Thank you! We hope you love it.' } }));
  assert.equal(v2.version, 2);
  assert.equal(v2.status, 'DRAFT');
  const pjob2 = ok(await upload(S.ops.token, cOrg, { ...fields, orderCount: 2 }));
  assert.equal(ok(await call('GET', `/labels/${pjob2.id}/notes`, { token: S.c })).template.id, draft.id);
  S.cOrg = cOrg;
});

test('low stock: severity per low-stock-alerts §7, velocity never guessed, urgent alerts to client + manager, plan-gated', async () => {
  const resellerOrg = ok(await call('GET', '/auth/me', { token: S.reseller })).organization.id;
  const rows = [
    { sku: 'BD-4', sellable: 0, avgDailySales: 2 },
    { sku: 'LAMP-1', name: 'Brass Lamp', sellable: 10, avgDailySales: 4, inbound: 50 },
    { sku: 'LAMP-2', name: 'Brass Lamp XL', sellable: 30, avgDailySales: 3 },
    { sku: 'TRAY-1', name: 'Tray', sellable: 60, avgDailySales: 3 },
    { sku: 'TRAY-2', name: 'Tray XL', sellable: 300, avgDailySales: 2 },
    { sku: 'NEW-1', name: 'New item', sellable: 15 },
  ];
  const body = { marketplace: 'AMAZON', dataAsOf: new Date().toISOString(), rows };
  assert.equal((await call('POST', `/ops/clients/${resellerOrg}/inventory`, { token: S.ops.token, body })).status, 403, 'Growth+ only');
  assert.equal((await call('POST', `/ops/clients/${S.bOrg}/inventory`, { token: S.ops.token, body: { ...body, rows: [rows[0], rows[0]] } })).status, 400, 'duplicate SKU');
  const r = ok(await call('POST', `/ops/clients/${S.bOrg}/inventory`, { token: S.ops.token, body }));
  assert.equal(r.urgent, 2);
  const inv = ok(await call('GET', '/inventory', { token: S.b }));
  const by = Object.fromEntries(inv.marketplaces.AMAZON.rows.map((x) => [x.sku, x]));
  assert.equal(by['BD-4'].severity, 'CRITICAL');
  assert.equal(by['LAMP-1'].severity, 'CRITICAL', '2.5 days of cover');
  assert.equal(by['LAMP-2'].severity, 'MEDIUM', '10 days');
  assert.equal(by['TRAY-1'].severity, 'WATCH', '20 days');
  assert.equal(by['TRAY-2'].severity, 'HEALTHY');
  assert.equal(by['NEW-1'].severity, null, 'no sales velocity → no severity guessed');
  assert.equal(inv.marketplaces.AMAZON.rows[0].severity, 'CRITICAL', 'most urgent first');
  assert.equal(inv.marketplaces.AMAZON.stale, false);
  const alert = ok(await call('GET', '/notifications', { token: S.b })).find((n) => n.type === 'stock.alert');
  assert.match(alert.body, /BD-4/);
  assert.match(alert.body, /approval/);
  ok(await call('POST', `/inventory/${by['BD-4'].id}/acknowledge`, { token: S.b }));
  assert.equal((await call('POST', `/inventory/${by['BD-4'].id}/acknowledge`, { token: S.c })).status, 404);
  const old = ok(await call('POST', `/ops/clients/${S.bOrg}/inventory`, { token: S.ops.token, body: { marketplace: 'FLIPKART', dataAsOf: '2026-01-01', rows: [{ sku: 'TRAY-1', sellable: 100, avgDailySales: 1 }] } }));
  assert.equal(old.urgent, 0);
  assert.equal(ok(await call('GET', '/inventory', { token: S.b })).marketplaces.FLIPKART.stale, true, 'stale data is flagged');
});

test('admin: overview, client suspension (instant), plan limit edits enforced by the API, team roles, payments, audit, enquiries, announcements', async () => {
  const ov = ok(await call('GET', '/admin/overview', { token: S.admin }));
  assert.ok(ov.activeSubscriptions >= 3 && ov.mrrPaise > 0 && ov.clients >= 5);
  assert.equal((await call('GET', '/admin/overview', { token: S.ads.token })).status, 403);
  const clients = ok(await call('GET', '/admin/client-list', { token: S.ops.token }));
  assert.ok(clients.find((c) => c.id === S.bOrg).plan.code === 'GROWTH');
  const detail = ok(await call('GET', `/admin/clients/${S.bOrg}/detail`, { token: S.admin }));
  assert.ok(detail.onboarding.steps.length >= 6 && detail.marketplaces.length === 2);

  // Suspension takes effect on the very next request, and is reversible.
  assert.equal((await call('PATCH', `/admin/clients/${S.cOrg}/suspension`, { token: S.admin, body: { suspended: true } })).status, 400, 'reason required');
  ok(await call('PATCH', `/admin/clients/${S.cOrg}/suspension`, { token: S.admin, body: { suspended: true, reason: 'Payment dispute under review' } }));
  assert.equal((await call('GET', '/features', { token: S.c })).status, 403);
  ok(await call('PATCH', `/admin/clients/${S.cOrg}/suspension`, { token: S.admin, body: { suspended: false } }));
  ok(await call('GET', '/features', { token: S.c }));

  // Plan limits live in the DB: raising Reseller's Amazon limit to 4 unblocks the 4th listing.
  assert.equal((await call('PATCH', '/admin/plans/RESELLER/features/NEW_LISTING_AMAZON', { token: S.ops.token, body: { enabled: true, limitValue: 4 } })).status, 403, 'super admin only');
  assert.equal((await call('PATCH', '/admin/plans/RESELLER/features/ADS_MANAGEMENT', { token: S.admin, body: { enabled: true, limitValue: 5 } })).status, 400, 'non-metered features take no limit');
  ok(await call('PATCH', '/admin/plans/RESELLER/features/NEW_LISTING_AMAZON', { token: S.admin, body: { enabled: true, limitValue: 4 } }));
  const prods = ok(await call('GET', '/products', { token: S.reseller }));
  const fourth = prods.find((p) => p.sku === 'SB-4');
  assert.equal(ok(await call('POST', '/listings', { token: S.reseller, body: { productId: fourth.id, marketplaces: ['AMAZON'] } })).results[0].created, true);
  ok(await call('PATCH', '/admin/plans/RESELLER/features/NEW_LISTING_AMAZON', { token: S.admin, body: { enabled: true, limitValue: 3 } }));
  const plans = ok(await call('GET', '/admin/plans', { token: S.admin }));
  assert.equal(plans.find((p) => p.code === 'RESELLER').features.find((f) => f.key === 'NEW_LISTING_AMAZON').limitValue, 3);
  ok(await call('PATCH', '/admin/plans/GROWTH', { token: S.admin, body: { pricePaise: 549900 } }));
  assert.equal(ok(await call('GET', '/plans')).find((p) => p.code === 'GROWTH').pricePaise, 549900, 'public pricing reads the DB');
  ok(await call('PATCH', '/admin/plans/GROWTH', { token: S.admin, body: { pricePaise: 499900 } }));

  // Team: role change, last-admin guard, 2FA reset.
  const temp = await staff('SUPPORT_EXECUTIVE', S.admin);
  ok(await call('PATCH', `/admin/users/${temp.id}/role`, { token: S.admin, body: { staffRole: 'ADS_MANAGER' } }));
  const team = ok(await call('GET', '/admin/team', { token: S.admin }));
  assert.equal(team.find((t) => t.id === temp.id).staffRole, 'ADS_MANAGER');
  const adminId = (await db.user.findUnique({ where: { email: ADMIN.email } })).id;
  assert.equal((await call('PATCH', `/admin/users/${adminId}/deactivate`, { token: S.admin })).status, 400, 'cannot deactivate yourself / last admin');
  assert.ok(team.find((t) => t.id === adminId).twoFactorEnabled);

  const payments = ok(await call('GET', '/admin/payments', { token: S.acct.token }));
  assert.ok(payments.some((p) => p.status === 'VERIFIED' && p.invoice?.number?.startsWith('SOL/')));
  assert.ok(payments.some((p) => p.status === 'FAILED'));
  assert.equal((await call('GET', '/admin/audit', { token: S.ops.token })).status, 403, 'audit log is super admin only');
  const audit = ok(await call('GET', '/admin/audit?action=plan.', { token: S.admin }));
  assert.ok(audit.some((a) => a.action === 'plan.feature_update' && a.actor.email === ADMIN.email));

  // Public contact form → admin inbox (honeypot + validation).
  assert.equal((await call('POST', '/public/contact', { body: { name: 'Bot', email: 'bot@x.test', message: 'Buy cheap followers now!!', website: 'http://spam' } })).status, 400);
  ok(await call('POST', '/public/contact', { body: { name: 'Kavya Rao', email: 'kavya@shop.test', phone: '9876512345', business: 'Kavya Crafts', topic: 'PLANS', message: 'Which plan suits 40 SKUs on Amazon?' } }));
  const inq = ok(await call('GET', '/admin/inquiries', { token: S.ops.token }));
  assert.equal(inq[0].name, 'Kavya Rao');
  ok(await call('PATCH', `/admin/inquiries/${inq[0].id}`, { token: S.ops.token, body: { status: 'CONTACTED' } }));
  assert.ok(await db.notification.findFirst({ where: { type: 'admin.inquiry', userId: adminId } }));

  const ann = ok(await call('POST', '/admin/announcements', { token: S.admin, body: { title: 'Diwali dispatch schedule', body: 'Label cut-off moves to 11 AM from 8–12 Nov.', audience: 'GROWTH' } }));
  assert.ok(ann.recipients >= 1);
  assert.ok(ok(await call('GET', '/notifications', { token: S.b })).some((n) => n.type === 'announcement'));
  assert.ok(!ok(await call('GET', '/notifications', { token: S.reseller })).some((n) => n.type === 'announcement'), 'audience respected');
});

test('subscription: cancel at period end → no reminder, no grace → expired; undo restores renewal', async () => {
  const t = await registerCustomer('Gauri');
  await pay(t, 'RESELLER');
  ok(await call('POST', '/billing/cancel', { token: t, body: { cancel: true, reason: 'Seasonal business' } }));
  let b = ok(await call('GET', '/billing', { token: t }));
  assert.equal(b.subscriptions[0].cancelAtPeriodEnd, true);
  ok(await call('POST', '/billing/cancel', { token: t, body: { cancel: false } }));
  ok(await call('POST', '/billing/cancel', { token: t, body: { cancel: true } }));
  const org = ok(await call('GET', '/auth/me', { token: t })).organization.id;
  await db.subscription.updateMany({ where: { organizationId: org, status: 'ACTIVE' }, data: { currentPeriodEnd: new Date(Date.now() - 60_000) } });
  const sweep = ok(await call('POST', '/admin/billing/sweep', { token: S.admin }));
  assert.ok(sweep.expired >= 1);
  b = ok(await call('GET', '/billing', { token: t }));
  assert.equal(b.subscriptions[0].status, 'EXPIRED', 'no grace period after a requested cancellation');
  assert.equal(ok(await call('GET', '/features', { token: t })).plan, null, 'service ends');
  assert.ok(ok(await call('GET', '/notifications', { token: t })).some((n) => n.type === 'subscription.expired'));
  assert.equal((await call('POST', '/billing/cancel', { token: t, body: { cancel: true } })).status, 400);
});

test('label cropper: plan modes enforced by the API; auto crop and specialised picklist run in the background; source deleted', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  // A Flipkart-style "invoice_labels" PDF: label on the top half, tax invoice below.
  async function flipkartPdf(n) {
    const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < n; i++) {
      const p = doc.addPage([595, 842]); const t = (s, x, y, size = 7) => p.drawText(s, { x, y, size, font: f });
      t('STD', 193, 801, 8); t('E-Kart Logistics', 216, 805, 6); t(`OD43906324113750510${i}`, 216, 793); t('E', 393, 799, 11); t('Ordered through', 193, 781);
      t('SKU ID | Description', 256, 557, 6); t('QTY', 387, 557, 6); t('1', 192, 548, 6); t(`SKU-${i % 2 ? 'B' : 'A'} | Test Product ${i % 2 ? 'B' : 'A'}`, 200, 548, 6); t(String(i + 1), 384, 548, 6);
      t(`FMPC67260166${i}0`, 199, 500); t('Not for resale.', 193, 469, 6); t('Printed at 1122 hrs', 293, 469, 6);
      t('Tax Invoice', 52, 442, 8); t('Sold By', 52, 395, 8);
    }
    return Buffer.from(await doc.save());
  }
  async function crop(token, fields, buf = null) {
    const fd = new FormData(); fd.append('file', new Blob([buf ?? await flipkartPdf(5)], { type: 'application/pdf' }), 'invoice_labels.pdf');
    for (const [k, v] of Object.entries({ marketplace: 'FLIPKART', ...fields })) fd.append(k, String(v));
    const r = await fetch(`${base}/label-crops`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
    return { status: r.status, body: await r.json() };
  }
  async function done(token, id) {
    for (let i = 0; i < 60; i++) {
      const j = ok(await call('GET', '/label-crops', { token })).jobs.find((x) => x.id === id);
      if (['DONE', 'FAILED'].includes(j.status)) return j;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('crop job did not finish');
  }
  const reseller = await registerCustomer('Rekha'); await pay(reseller, 'RESELLER');
  const growth = await registerCustomer('Gauri'); await pay(growth, 'GROWTH');
  const premium = await registerCustomer('Pooja'); await pay(premium, 'PREMIUM');

  assert.deepEqual(ok(await call('GET', '/label-crops', { token: reseller })).modes, ['MANUAL']);
  assert.deepEqual(ok(await call('GET', '/label-crops', { token: growth })).modes, ['AUTO', 'MANUAL']);
  assert.deepEqual(ok(await call('GET', '/label-crops', { token: premium })).modes, ['AUTO', 'SPECIAL', 'MANUAL']);
  assert.equal((await crop(reseller, { mode: 'AUTO' })).status, 403, 'Reseller: manual only');
  assert.equal((await crop(growth, { mode: 'SPECIAL' })).status, 403, 'Growth: no specialised');
  assert.equal((await crop(growth, { mode: 'AUTO' }, Buffer.from('not a pdf'))).status, 400);

  const g = await crop(growth, { mode: 'AUTO', layout: 'A4_4UP' });
  assert.equal(g.status, 201); assert.equal(g.body.status, 'QUEUED', 'queued, not processed in the request');
  const gj = await done(growth, g.body.id);
  assert.equal(gj.status, 'DONE', gj.error); assert.equal(gj.marketplace, 'FLIPKART'); assert.equal(gj.labelCount, 5);
  const dl = await fetch(`${base}/label-crops/${gj.id}/download`, { headers: { authorization: `Bearer ${growth}` } });
  assert.equal(dl.status, 200);
  const out = await PDFDocument.load(Buffer.from(await dl.arrayBuffer()));
  assert.equal(out.getPageCount(), 2, '5 labels on A4 4-up = 2 pages, invoices left out');
  const row = await db.labelCropJob.findUnique({ where: { id: gj.id } });
  assert.equal(row.sourceKey, null, 'uploaded original (buyer addresses) deleted after processing');
  assert.equal((await fetch(`${base}/label-crops/${gj.id}/download`, { headers: { authorization: `Bearer ${premium}` } })).status, 404, 'tenant isolation');

  // Each marketplace has its own tab: a Flipkart file uploaded as Amazon is refused with a clear message.
  const wrong = await done(growth, (await crop(growth, { mode: 'AUTO', marketplace: 'AMAZON' })).body.id);
  assert.equal(wrong.status, 'FAILED'); assert.match(wrong.error, /Flipkart label PDF\. Upload it in the Flipkart tab/);
  const single = await done(growth, (await crop(growth, { mode: 'AUTO', layout: 'SINGLE' })).body.id);
  assert.equal(single.labelCount, 5);

  const p = await crop(premium, { mode: 'SPECIAL', layout: 'A4_4UP', includeInvoices: 'true' });
  const pj = await done(premium, p.body.id);
  assert.equal(pj.status, 'DONE', pj.error);
  const pout = await PDFDocument.load(Buffer.from(await (await fetch(`${base}/label-crops/${pj.id}/download`, { headers: { authorization: `Bearer ${premium}` } })).arrayBuffer()));
  assert.equal(pout.getPageCount(), 1 + 2 + 3, 'picklist + 2 label pages + 5 invoices two per page');
  assert.ok(await db.notification.findFirst({ where: { type: 'labels.ready', title: { contains: '5 labels' } } }), 'client notified when ready');
});

test('listing & mapping forms: validation, mapping + new-listing workflow records, quota, templates', async () => {
  const c = await registerCustomer('Farah'); await pay(c, 'RESELLER');
  const base = { sellerSku: 'TC-1L', listingStatus: 'Active', mrp: 199, sellingPrice: 189, procurementType: 'Instock', procurementSlaDays: 2, lengthCm: 10, breadthCm: 8, heightCm: 25, weightKg: 1.1, stock: 50, hsn: '38249900', taxCode: 'GST_18', countryOfOrigin: 'India', manufacturerDetails: 'Pidilite Industries, Mumbai', packerDetails: 'Pidilite Industries, Mumbai' };
  const bad = await call('POST', '/catalog-forms', { token: c, body: { marketplace: 'FLIPKART', kind: 'MAPPING', data: { ...base, productLink: 'abc', sellerSku: '', procurementType: '', weightKg: '', mrp: 100, sellingPrice: 150, hsn: '12', minOrderQty: '5' } } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fieldErrors.productLink && !bad.body.fieldErrors.sellerSku && bad.body.fieldErrors.procurementType && bad.body.fieldErrors.weightKg && bad.body.fieldErrors.sellingPrice && bad.body.fieldErrors.hsn && bad.body.fieldErrors.minOrderQty, JSON.stringify(bad.body.fieldErrors));

  const m = ok(await call('POST', '/catalog-forms', { token: c, body: { marketplace: 'FLIPKART', kind: 'MAPPING', data: { ...base, productLink: 'https://www.flipkart.com/p/itm123?pid=TCLFX7ZGHYQ2KJWE&lid=X' }, saveTemplateAs: 'Tile cleaner 1L' } }));
  assert.equal(m.template.name, 'Tile cleaner 1L');
  const req = await db.serviceRequest.findUnique({ where: { id: m.request.id } });
  assert.equal(req.featureKey, 'CATALOG_MAPPING'); assert.equal(req.details.fields.sellingPrice, 189); assert.equal(req.details.fields.productRef, 'TCLFX7ZGHYQ2KJWE', 'FSN taken from the link'); assert.match(req.title, /Flipkart mapping: TCLFX7ZGHYQ2KJWE \(SKU TC-1L\)/);
  assert.equal(req.details.fields.fulfilmentBy, 'Seller'); assert.equal(req.details.fields.shippingProvider, 'Flipkart', 'fixed Flipkart values');
  assert.equal(req.details.fields.productName, undefined, 'no product name field on Flipkart mapping');
  // Blank optional fields get the agreed defaults; blank SKU gets a generated one.
  assert.deepEqual([req.details.fields.localHandlingFee, req.details.fields.zonalHandlingFee, req.details.fields.nationalHandlingFee, req.details.fields.luxuryCessPct, req.details.fields.importerDetails], [0, 0, 0, 0, 'None']);
  const auto = ok(await call('POST', '/catalog-forms', { token: c, body: { marketplace: 'FLIPKART', kind: 'MAPPING', data: { ...base, sellerSku: '', productLink: 'TCLFX7ZGHYQ2KJWF' } } }));
  const autoReq = await db.serviceRequest.findUnique({ where: { id: auto.request.id } });
  assert.match(autoReq.details.fields.sellerSku, /^SOL-FK-[2-9A-Z]{8}$/, 'blank SKU → SOLLUNA SKU');
  assert.ok(await db.catalogMapping.findFirst({ where: { serviceRequestId: req.id, sellerSku: 'TC-1L' } }), 'mapping row for the manager');

  const listing = { ...base, productTitle: 'Roff Tile Cleaner 1L', brand: 'Roff', category: 'Cleaning > Tile cleaner', keyFeatures: 'Removes stains', description: 'Professional tile cleaner', imageLinks: 'https://drive.google.com/x', condition: 'New', fulfilmentChannel: 'Easy Ship (Amazon delivers)' };
  for (let i = 1; i <= 3; i++) ok(await call('POST', '/catalog-forms', { token: c, body: { marketplace: 'AMAZON', kind: 'NEW_LISTING', data: { ...listing, sellerSku: `RT-${i}` } } }));
  const lr = await db.listingRequest.findMany({ where: { product: { sku: { in: ['RT-1', 'RT-2', 'RT-3'] } } } });
  assert.equal(lr.length, 3, 'new listing form creates product + listing for the lifecycle');
  const fourth = await call('POST', '/catalog-forms', { token: c, body: { marketplace: 'AMAZON', kind: 'NEW_LISTING', data: { ...listing, sellerSku: 'RT-4' } } });
  assert.equal(fourth.status, 201); assert.equal(fourth.body.request.entitlement, 'LIMIT_REACHED', 'Reseller: 3 new Amazon listings a month');
  assert.equal((await call('POST', '/catalog-forms', { token: c, body: { marketplace: 'AMAZON', kind: 'NEW_LISTING', data: { ...listing, sellerSku: 'RT-1' } } })).status, 409, 'same SKU twice');

  // Flipkart new listing: owner's field list, up to 5 uploaded images (client's own image documents only), list fields.
  const img1 = (await upload(c, 'front.png', PNG, { kind: 'LISTING_ASSETS' })).body.id;
  const img2 = (await upload(c, 'back.png', PNG, { kind: 'LISTING_ASSETS' })).body.id;
  const pdf = (await upload(c, 'spec.pdf', PDF, { kind: 'LISTING_ASSETS' })).body.id;
  const fk = { ...base, sellerSku: 'FC-500', vertical: 'Floor Cleaner', brand: 'Roff', modelName: 'Floor Cleaner Lavender', brandFragrance: 'Lavender', quantityL: 0.5, suitableFor: 'Floor', formFactor: 'Liquid', packOf: 1, containerType: 'Bottle', keyFeatures: 'Kills 99.9% germs, Streak-free\nKills 99.9% germs', description: 'Floor cleaner' };
  const noImg = await call('POST', '/catalog-forms', { token: c, body: { marketplace: 'FLIPKART', kind: 'NEW_LISTING', data: { ...fk, modelName: '' } } });
  assert.equal(noImg.status, 400); assert.ok(noImg.body.fieldErrors.images && noImg.body.fieldErrors.modelName, JSON.stringify(noImg.body.fieldErrors));
  assert.ok((await call('POST', '/catalog-forms', { token: c, body: { marketplace: 'FLIPKART', kind: 'NEW_LISTING', data: { ...fk, images: `${img1},${pdf}` } } })).body.fieldErrors.images, 'a PDF is not an image');
  assert.ok((await call('POST', '/catalog-forms', { token: c, body: { marketplace: 'FLIPKART', kind: 'NEW_LISTING', data: { ...fk, images: Array(6).fill(0).map((_, i) => `img${i}aaaaaaaaaaaaaaaaaaaaa`).join(',') } } })).body.fieldErrors.images, 'at most 5 images');
  const fkr = ok(await call('POST', '/catalog-forms', { token: c, body: { marketplace: 'FLIPKART', kind: 'NEW_LISTING', data: { ...fk, images: `${img1},${img2}` } } }));
  const fkReq = await db.serviceRequest.findUnique({ where: { id: fkr.request.id } });
  assert.equal(fkReq.featureKey, 'NEW_LISTING_FLIPKART'); assert.match(fkReq.title, /Flipkart new listing: Floor Cleaner Lavender \(SKU FC-500\)/);
  assert.equal(fkReq.details.fields.images, `${img1},${img2}`); assert.equal(fkReq.details.fields.keyFeatures, 'Kills 99.9% germs\nStreak-free', 'list values split and de-duplicated');
  assert.equal(fkReq.details.fields.fulfilmentBy, 'Seller');

  // Amazon mapping: owner's list only; condition always New, audience / pricing rule default, HSN 6–8 digits.
  const azBad = await call('POST', '/catalog-forms', { token: c, body: { marketplace: 'AMAZON', kind: 'MAPPING', data: { productLink: 'https://www.amazon.in/dp/B07ABC1234', hsn: '6105', sellingPrice: 315, mrp: 399 } } });
  assert.equal(azBad.status, 400); assert.ok(azBad.body.fieldErrors.hsn && azBad.body.fieldErrors.fulfilmentChannel && !azBad.body.fieldErrors.sellerSku, JSON.stringify(azBad.body.fieldErrors));
  const az = ok(await call('POST', '/catalog-forms', { token: c, body: { marketplace: 'AMAZON', kind: 'MAPPING', data: { productLink: 'https://www.amazon.in/dp/B07ABC1234', hsn: '610510', fulfilmentChannel: 'Merchant Fulfilled (Self Ship / Easy Ship)', sellingPrice: 315, mrp: 399, condition: 'Used - Good', productName: 'x' } } }));
  const azF = (await db.serviceRequest.findUnique({ where: { id: az.request.id } })).details.fields;
  assert.equal(azF.condition, 'New', 'always New'); assert.equal(azF.audience, 'Sell on Amazon'); assert.equal(azF.pricingRule, 'No rule — keep my price'); assert.equal(azF.externalProductInfoEntity, 'HSN');
  assert.equal(azF.productRef, 'B07ABC1234'); assert.equal(azF.productName, undefined); assert.match(azF.sellerSku, /^SOL-AZ-/);

  // Templates: partial values allowed, same name updates, scoped to the client.
  const t = ok(await call('POST', '/catalog-forms/templates', { token: c, body: { marketplace: 'FLIPKART', kind: 'MAPPING', name: 'Tile cleaner 1L', data: { minOrderQty: '2', stock: 10 } } }));
  const list = ok(await call('GET', '/catalog-forms', { token: c }));
  assert.equal(list.templates.length, 1); assert.deepEqual(list.templates[0].data, { minOrderQty: '2', stock: 10 });
  assert.equal(list.submissions.length, 8);
  assert.equal((await call('POST', '/catalog-forms/templates', { token: c, body: { marketplace: 'FLIPKART', kind: 'MAPPING', name: 'Empty', data: {} } })).status, 400);
  const other = await registerCustomer('Gita'); await pay(other, 'GROWTH');
  assert.equal((await call('DELETE', `/catalog-forms/templates/${t.id}`, { token: other })).status, 404, 'tenant isolation');
  ok(await call('DELETE', `/catalog-forms/templates/${t.id}`, { token: c }));
  assert.equal(ok(await call('GET', '/catalog-forms', { token: c })).templates.length, 0);
});

test('product lookup: link → background web lookup → only valid form fields; cache, pause_turn, not found, daily limit, isolation', async () => {
  const c = await registerCustomer('Lata'); await pay(c, 'GROWTH');
  assert.equal(ok(await call('GET', '/catalog-forms', { token: c })).lookupAvailable, true);
  const wait = async (id, token = c) => { for (let i = 0; i < 40; i++) { const r = ok(await call('GET', `/catalog-forms/lookup/${id}`, { token })); if (r.status === 'DONE' || r.status === 'FAILED') return r; await new Promise((x) => setTimeout(x, 200)); } throw new Error('lookup did not finish'); };
  const link = 'https://www.flipkart.com/roff/p/itm1?pid=TCLFX7ZGHYQ2KJWE';
  const start = ok(await call('POST', '/catalog-forms/lookup', { token: c, body: { marketplace: 'FLIPKART', kind: 'MAPPING', link } }));
  assert.equal(start.status, 'QUEUED', 'runs in the background, not in the request');
  const r = await wait(start.id);
  assert.equal(r.status, 'DONE');
  assert.deepEqual(r.fields, { mrp: 249, lengthCm: 9, breadthCm: 6, heightCm: 27, weightKg: 1.1, hsn: '34022090', taxCode: 'GST_18', countryOfOrigin: 'India', manufacturerDetails: PRODUCT.manufacturer, packerDetails: PRODUCT.packer, shelfLifeMonths: 24 }, 'only the mapping form\'s fields');
  assert.equal(r.fields.sellerSku, undefined, 'seller data is never invented');
  const req = claude.calls[claude.calls.length - 1];
  assert.equal(req.body.model, 'claude-opus-5-5'); assert.equal(req.body.fallbacks, 'default');
  assert.deepEqual(req.body.tools.map((t) => t.type ?? t.name), ['web_search_20260209', 'web_fetch_20260209', 'submit_product_details']);
  assert.match(JSON.stringify(req.body.messages[0].content), /TCLFX7ZGHYQ2KJWE/);

  // New listing form: same product, its own fields (title, features, images…); reused for 7 days without a new API call.
  const before = claude.calls.length;
  const nl = await wait(ok(await call('POST', '/catalog-forms/lookup', { token: c, body: { marketplace: 'FLIPKART', kind: 'NEW_LISTING', link: 'TCLFX7ZGHYQ2KJWE' } })).id);
  assert.equal(nl.cached, true); assert.equal(claude.calls.length, before, 'cached result, no new lookup');
  assert.equal(nl.fields.brand, 'Roff'); assert.equal(nl.fields.eanUpc, '8901234567897'); assert.ok(nl.fields.vertical); assert.equal(nl.fields.images, undefined, 'images are uploaded by the client, never taken from the web');
  assert.match(nl.fields.keyFeatures, /Removes tough stains\nSafe on tiles/);

  const p = await wait(ok(await call('POST', '/catalog-forms/lookup', { token: c, body: { marketplace: 'AMAZON', kind: 'MAPPING', link: 'https://www.amazon.in/x/dp/B0PAUSE001' } })).id);
  assert.equal(p.status, 'DONE', 'pause_turn is resumed');
  const resumed = claude.calls[claude.calls.length - 1].body.messages;
  assert.equal(resumed.length, 2); assert.equal(resumed[1].role, 'assistant'); assert.equal(resumed[1].content[0].type, 'server_tool_use');
  const nf = await wait(ok(await call('POST', '/catalog-forms/lookup', { token: c, body: { marketplace: 'AMAZON', kind: 'MAPPING', link: 'https://www.amazon.in/notfound/dp/B0NOTFOUND' } })).id);
  assert.equal(nf.status, 'FAILED'); assert.match(nf.error, /could not find this product/);
  assert.equal((await call('POST', '/catalog-forms/lookup', { token: c, body: { marketplace: 'AMAZON', kind: 'MAPPING', link: 'https://www.amazon.in/dp/B0LIMIT0001' } })).status, 429, 'daily limit (3 in tests)');
  assert.equal((await call('POST', '/catalog-forms/lookup', { token: c, body: { marketplace: 'FLIPKART', kind: 'MAPPING', link: 'just words' } })).status, 400);
  const other = await registerCustomer('Mohan'); await pay(other, 'RESELLER');
  assert.equal((await call('GET', `/catalog-forms/lookup/${start.id}`, { token: other })).status, 404, 'tenant isolation');
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
