// Demo data for the TEMPORARY Render preview, created through the public API of the deployed preview.
// It never touches Razorpay: demo plans come from apps/api/prisma/seed-preview.ts (no payments, no invoices).
//
//   node deploy/render/seed-demo.mjs <https://preview-url> accounts    # admin 2FA, staff, demo clients, billing profiles
//   (restart the API service → seed-preview.ts gives the demo clients their demo plan)
//   node deploy/render/seed-demo.mjs <https://preview-url> workflows   # listings, mapping, ads, labels, stock, reports, tickets …
//
// Env: ADMIN_EMAIL, ADMIN_PASSWORD, [ADMIN_TOTP_SECRET], STAFF_PASSWORD, CLIENT_PASSWORD.
// Without ADMIN_TOTP_SECRET the "accounts" phase enrols the admin in 2FA and prints the setup key once.
import { createHmac } from 'node:crypto';

const BASE = (process.argv[2] ?? '').replace(/\/$/, '');
const PHASE = process.argv[3];
if (!/^https?:\/\//.test(BASE) || !['accounts', 'workflows'].includes(PHASE)) {
  console.error('Usage: seed-demo.mjs <base-url> accounts|workflows'); process.exit(2);
}
if (/\/\/(www\.)?solluna\.co\.in/i.test(BASE)) { console.error('Refusing to seed demo data on the production domain.'); process.exit(2); }
const env = (k) => { const v = process.env[k]; if (!v) { console.error(`Missing env ${k}`); process.exit(2); } return v; };
const ADMIN_EMAIL = env('ADMIN_EMAIL'), ADMIN_PASSWORD = env('ADMIN_PASSWORD'), STAFF_PW = env('STAFF_PASSWORD'), CLIENT_PW = env('CLIENT_PASSWORD');
let TOTP = process.env.ADMIN_TOTP_SECRET;
const api = BASE + '/api';

function totp(secret, at = Date.now()) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of secret.replace(/\s+/g, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac('sha1', key).update(msg).digest(); const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, token, body, { allow = [] } = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(api + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429 && attempt < 6) { await sleep(15_000); continue; } // auth rate limit
    if (r.ok || allow.includes(r.status)) return { status: r.status, ...(Array.isArray(j) ? { list: j } : j) };
    throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  }
}
const get = async (path, token) => { const r = await call('GET', path, token); return r.list ?? r; };
async function form(path, token, name, buf, fields) {
  const fd = new FormData(); fd.append('file', new Blob([buf]), name); for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  const r = await fetch(api + path, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd }); const j = await r.json();
  if (!r.ok) throw new Error(`POST ${path} → ${r.status} ${JSON.stringify(j)}`); return j;
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
async function login(email, password) {
  const r = await call('POST', '/auth/login', null, { email, password }, { allow: [401] });
  if (r.status === 401 && r.twoFactorRequired && !TOTP) throw new Error(`${email} has 2FA on — set ADMIN_TOTP_SECRET`);
  if (r.status === 401 && r.twoFactorRequired) return (await call('POST', '/auth/login', null, { email, password, code: totp(TOTP) })).token;
  if (r.status === 401) throw new Error(`login failed for ${email}`);
  return r.token;
}

// Wake the free services (they sleep after 15 minutes idle; a cold start takes up to a minute).
for (let i = 0; ; i++) {
  try { const h = await (await fetch(api + '/health')).json(); if (h.ok) break; } catch {}
  if (i > 40) throw new Error('preview did not wake up'); await sleep(5000);
}

const STAFF = [
  ['Kabir Mehta', 'kabir@demo.solluna.co.in', 'OPERATIONS_MANAGER'], ['Meera Shah', 'meera@demo.solluna.co.in', 'ACCOUNTS_EXECUTIVE'],
  ['Rohan Verma', 'rohan@demo.solluna.co.in', 'ADS_MANAGER'], ['Isha Patel', 'isha@demo.solluna.co.in', 'LISTING_EXECUTIVE'],
  ['Neha Joshi', 'neha@demo.solluna.co.in', 'SUPPORT_EXECUTIVE'],
];
const CLIENTS = [
  { key: 'riya', reg: { name: 'Riya Shah', email: 'riya@demo.solluna.co.in', phone: '9812345678', legalName: 'Riya Home Decor LLP (Demo)', brandName: 'Riya Home', gstin: '24ABCDE1234F1Z6' },
    billing: { gstin: '24ABCDE1234F1Z6', address: '12, Satellite Road', city: 'Ahmedabad', pincode: '380015' } },
  { key: 'amit', reg: { name: 'Amit Sharma', email: 'amit@demo.solluna.co.in', phone: '9823456789', legalName: 'Sharma Kitchenware (Demo)' },
    billing: { stateCode: '27', address: '7 Linking Road, Bandra West', city: 'Mumbai', pincode: '400050' } },
  { key: 'kavya', reg: { name: 'Kavya Rao', email: 'kavya@demo.solluna.co.in', phone: '9845012345', legalName: 'Kavya Crafts Pvt Ltd (Demo)', brandName: 'Kavya Crafts', gstin: '29AAGCK1234M1ZB' },
    billing: { gstin: '29AAGCK1234M1ZB', address: '44, 4th Cross, Indiranagar', city: 'Bengaluru', pincode: '560038' } },
];

if (PHASE === 'accounts') {
  // Admin: enrol 2FA once (super admins cannot use the console without it).
  let admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const me = await get('/auth/me', admin);
  if (!me.user?.twoFactorEnabled && !me.twoFactorEnabled) {
    const setup = await call('POST', '/auth/2fa/setup', admin);
    await call('POST', '/auth/2fa/enable', admin, { code: totp(setup.secret) });
    TOTP = setup.secret;
    console.log(`ADMIN_TOTP_SECRET=${setup.secret}   ← add to Google Authenticator (setup key), keep private`);
    admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  }
  for (const [name, email, staffRole] of STAFF) await call('POST', '/admin/users/staff', admin, { name, email, password: STAFF_PW, staffRole }, { allow: [409] });
  const staff = await get('/admin/staff', admin);
  const kabirId = staff.find((s) => s.email === 'kabir@demo.solluna.co.in').id;
  for (const c of CLIENTS) {
    const r = await call('POST', '/auth/register', null, { ...c.reg, password: CLIENT_PW }, { allow: [409] });
    const token = r.status === 409 ? await login(c.reg.email, CLIENT_PW) : r.token;
    await call('PATCH', '/billing/profile', token, c.billing);
    const orgId = (await get('/auth/me', token)).organization.id;
    await call('POST', `/admin/clients/${orgId}/managers`, admin, { managerId: kabirId }, { allow: [409] });
    console.log(`client ready: ${c.reg.email}`);
  }
  console.log('ACCOUNTS OK — now restart the API service so seed-preview.ts attaches the demo plans.');
  process.exit(0);
}

// ── workflows ───────────────────────────────────────────────────────────────────────────────────────
const [kabir, meera, rohan, isha, neha] = await Promise.all(STAFF.map(([, e]) => login(e, STAFF_PW)));
const [riya, amit, kavya] = await Promise.all(CLIENTS.map((c) => login(c.reg.email, CLIENT_PW)));
const orgOf = async (t) => (await get('/auth/me', t)).organization.id;
const riyaOrg = await orgOf(riya), kavyaOrg = await orgOf(kavya);
for (const [t, n] of [[riya, 'riya'], [amit, 'amit'], [kavya, 'kavya']]) {
  const b = await get('/billing', t);
  if (!b.subscriptions?.some((s) => s.status === 'ACTIVE')) throw new Error(`${n} has no demo plan yet — restart the API service first`);
}
if ((await get('/products', riya)).length) { console.log('Workflow demo data already present — nothing to do.'); process.exit(0); }
const today = new Date().toISOString().slice(0, 10);
const tasks = async (token, id) => (await get(`/requests/${id}`, token)).request.tasks;
async function doTask(token, id, evidence) { await call('PATCH', `/ops/tasks/${id}`, token, { status: 'IN_PROGRESS' }); if (evidence) await call('PATCH', `/ops/tasks/${id}`, token, { status: 'COMPLETED', evidence }); }

// Riya (Growth, Gujarat): documents, marketplaces, products, listings, mapping
await form('/documents', riya, 'GST certificate.pdf', PDF, { kind: 'GST_CERT', title: 'GST registration certificate' });
await form('/documents', riya, 'Brand authorization.pdf', PDF, { kind: 'BRAND_AUTH' });
await call('PUT', '/marketplaces/AMAZON', riya, { hasAccount: true, storeName: 'Riya Home Decor', sellerId: 'A3RIYAHOME01', contactEmail: 'seller@riyahome.example' });
await call('PUT', '/marketplaces/FLIPKART', riya, { hasAccount: true, storeName: 'RiyaHome', sellerId: 'f7c1riya9' });
await call('PATCH', `/ops/clients/${riyaOrg}/marketplaces/AMAZON`, kabir, { status: 'CONNECTED', note: 'Demo: user permission accepted in Seller Central → Manage Users' });
const P = [
  { name: 'Brass Diya Set of 4', sku: 'RH-DIYA-4', brand: 'Riya Home', category: 'Home Decor > Diyas', hsn: '7418', mrp: 1299, sellingPrice: 899, gstRate: 12, specs: 'Pure brass, 3 in each, hand-polished' },
  { name: 'Jute Table Runner 72 in', sku: 'RH-JTR-72', brand: 'Riya Home', category: 'Home Furnishing > Table Linen', hsn: '6304', mrp: 999, sellingPrice: 649, gstRate: 12 },
  { name: 'Macrame Wall Hanging', sku: 'RH-MAC-01', brand: 'Riya Home', category: 'Home Decor > Wall Art', hsn: '5609', mrp: 1499, sellingPrice: 1099, gstRate: 12 },
];
const prods = []; for (const p of P) prods.push(await call('POST', '/products', riya, p));
await call('POST', '/listings', riya, { productId: prods[0].id, marketplaces: ['AMAZON', 'FLIPKART'], notes: 'Festive launch — go live this week' });
await call('POST', '/listings', riya, { productId: prods[1].id, marketplaces: ['AMAZON'] });
const L = await get('/listings', riya);
const lid = (name, mp) => L.find((l) => l.product.name === name && l.marketplace === mp).id;
await call('PATCH', `/ops/listings/${lid(P[0].name, 'AMAZON')}`, isha, { status: 'CONTENT_IN_PROGRESS', note: 'Title, bullets and keywords drafted' });
await call('PATCH', `/ops/listings/${lid(P[0].name, 'AMAZON')}`, isha, { status: 'SUBMITTED', note: 'Submitted in Seller Central' });
await call('PATCH', `/ops/listings/${lid(P[0].name, 'AMAZON')}`, isha, { status: 'ACTIVE', catalogId: 'B0DRIYA001', liveUrl: 'https://www.amazon.in/dp/B0DRIYA001' });
await call('PATCH', `/ops/listings/${lid(P[0].name, 'FLIPKART')}`, isha, { status: 'BRAND_APPROVAL_REQUIRED', note: 'Flipkart needs brand approval for "Riya Home" — please upload your trademark certificate or brand authorisation in Documents.' });
await call('PATCH', `/ops/listings/${lid(P[1].name, 'AMAZON')}`, isha, { status: 'CONTENT_IN_PROGRESS', note: 'Image QC: 2 of 7 images need a white background' });
const map = await call('POST', '/mappings', riya, { marketplace: 'AMAZON', items: [{ identifier: 'B08XYZ4321', sellerSku: 'RH-LAMP-01', productName: 'Brass Table Lamp' }, { identifier: 'Copper Bottle 1L', sellerSku: 'RH-CB-1L' }, { identifier: 'B07KLM9876', sellerSku: 'RH-URLI-10' }] });
const M = (await get('/mappings', riya)).filter((m) => m.serviceRequestId === map.requestId);
await call('PATCH', `/ops/mappings/${M.find((m) => m.sellerSku === 'RH-LAMP-01').id}`, isha, { status: 'EXACT_VERIFIED', candidateId: 'B08XYZ4321' });
await call('PATCH', `/ops/mappings/${M.find((m) => m.sellerSku === 'RH-CB-1L').id}`, isha, { status: 'NO_MATCH_FOUND', note: 'No existing ASIN with matching brand — needs a new listing' });

// Riya: orchestrated requests — ads awaiting budget approval, labels queued
const ads = await call('POST', '/requests', riya, { featureKey: 'ADS_MANAGEMENT', title: 'Sponsored Products for jute rugs', marketplace: 'AMAZON', details: { notes: 'Target ACOS under 30%' } });
await doTask(rohan, (await tasks(riya, ads.request.id))[0].id, { summary: 'Audit done: 3 campaigns planned, break-even ACOS 31%', outputUrl: 'https://docs.google.com/spreadsheets/d/demo-ads-plan', approvalParameters: { dailyBudgetInr: 750, campaigns: 3, durationDays: 14 } });
await call('POST', '/requests', riya, { featureKey: 'SHIPPING_LABEL_GENERATION', title: 'Labels for today’s 18 Amazon orders', marketplace: 'AMAZON', priority: 'P2' });

// Riya: shipping labels + inventory (low-stock severities)
await form(`/ops/clients/${riyaOrg}/labels`, kabir, 'labels.pdf', PDF, { marketplace: 'AMAZON', batchDate: today, orderCount: 18, dispatchBy: `${today}T13:00:00+05:30`, skippedOrders: '171-4455667 cancelled by buyer', note: 'Pickup slot 2–4 PM' });
await form(`/ops/clients/${riyaOrg}/labels`, kabir, 'labels.pdf', PDF, { marketplace: 'FLIPKART', batchDate: today, orderCount: 9, dispatchBy: `${today}T12:00:00+05:30` });
await call('POST', `/ops/clients/${riyaOrg}/inventory`, kabir, { marketplace: 'AMAZON', dataAsOf: new Date(Date.now() - 3 * 3600_000).toISOString(), rows: [
  { sku: 'RH-DIYA-4', sellable: 9, avgDailySales: 4.2, inbound: 120 }, { sku: 'RH-JTR-72', sellable: 0, avgDailySales: 1.5 },
  { sku: 'RH-MAC-01', sellable: 34, avgDailySales: 3.1 }, { sku: 'RH-LAMP-01', name: 'Brass Table Lamp', sellable: 52, avgDailySales: 2.4 },
  { sku: 'RH-URLI-10', name: 'Brass Urli 10 in', sellable: 140, avgDailySales: 1.8 }, { sku: 'RH-CB-1L', name: 'Copper Bottle 1L', sellable: 40 },
] });

// Riya: chat
await call('POST', '/chat/messages', riya, { body: 'Hi Kabir, can we push the jute rug campaign before the festive sale?' });
await call('POST', `/ops/chats/${riyaOrg}/messages`, kabir, { body: 'Margin on JR-02 is thin — keep bids conservative.', internal: true });
await call('POST', `/ops/chats/${riyaOrg}/messages`, kabir, { body: 'Yes Riya — Rohan has prepared the plan. Please approve the ₹750/day budget in Approvals and we go live.' });

// Riya: reports (September baseline + October with costs and confirmed expenses)
const MM = (o) => ({ salesBasis: 'SHIPPED', discountsPaise: 500_000, returnsRefundsPaise: 300_000, reimbursementsPaise: 100_000, orders: 90, unitsSold: 100, unitsReturned: 5, cancelledOrders: 10, sessions: 3000,
  commissionPaise: 1_500_000, fixedFeesPaise: 100_000, fulfilmentPaise: 300_000, shippingPaise: 100_000, storagePaise: 0, otherFeesPaise: 0, adSpendPaise: 300_000, adSalesPaise: 1_500_000, impressions: 50_000, clicks: 1_000,
  settlementPaise: 7_000_000, bankCreditPaise: 6_900_000, reservesPaise: 100_000, sourceNote: 'Demo: Amazon business report + settlement', ...o });
await call('PUT', `/ops/reports/${riyaOrg}/2026-09/marketplaces/AMAZON`, meera, MM({ grossSalesPaise: 8_200_000, orders: 76, unitsSold: 84 }));
await call('PUT', `/ops/reports/${riyaOrg}/2026-10/marketplaces/AMAZON`, meera, MM({ grossSalesPaise: 10_000_000 }));
await call('PUT', `/ops/reports/${riyaOrg}/2026-10/marketplaces/AMAZON/sku-lines`, meera, { lines: [
  { sku: 'JR-01', units: 60, netSalesPaise: 6_000_000, feesPaise: 1_200_000, adSpendPaise: 200_000 }, { sku: 'JR-02', units: 40, netSalesPaise: 3_300_000, feesPaise: 800_000, adSpendPaise: 100_000 }] });
await call('PUT', `/ops/reports/${riyaOrg}/2026-10/marketplaces/FLIPKART`, meera, { salesBasis: 'SHIPPED', grossSalesPaise: 2_400_000, discountsPaise: 100_000, returnsRefundsPaise: 150_000, reimbursementsPaise: 0, orders: 30, unitsSold: 32, unitsReturned: 3, cancelledOrders: 2, sessions: 900,
  commissionPaise: 360_000, fixedFeesPaise: 30_000, fulfilmentPaise: 0, shippingPaise: 96_000, storagePaise: 0, otherFeesPaise: 0, adSpendPaise: null, settlementPaise: 1_600_000, bankCreditPaise: null, sourceNote: 'Demo: Flipkart payments report' });
await call('POST', '/costs', riya, { sku: 'JR-01', costPaise: 40_000, effectiveFrom: '2026-10-01' });
await call('POST', '/costs', riya, { sku: 'JR-02', costPaise: 30_000, effectiveFrom: '2026-10-01' });
for (const [category, description, amountPaise] of [['RENT', 'Warehouse rent', 800_000], ['STAFF', 'Packing staff', 200_000]]) await call('POST', '/expenses', riya, { period: '2026-10', category, description, amountPaise });
await call('POST', '/expenses/confirm', riya, { period: '2026-10' });
for (const kind of ['PERFORMANCE', 'PL']) { const r = await call('POST', `/ops/reports/${riyaOrg}/2026-10/generate`, meera, { kind }); await call('POST', `/ops/reports/drafts/${r.id}/publish`, meera); }
const rep = await call('POST', '/requests', riya, { featureKey: 'MONTHLY_PL_REPORT', title: 'October 2026 reports' });
const reportList = await get('/reports', riya);
let t = await tasks(riya, rep.request.id);
await doTask(meera, t[0].id, { summary: 'October performance report published', reportId: reportList.find((r) => r.kind === 'PERFORMANCE').id });
t = await tasks(riya, rep.request.id);
await doTask(meera, t[1].id, { summary: 'October P&L published — Flipkart figures estimated (no SKU lines / bank credit yet)', reportId: reportList.find((r) => r.kind === 'PL').id });

// Tickets
const t1 = await call('POST', '/tickets', riya, { category: 'ACCOUNT_HEALTH', marketplace: 'AMAZON', subject: 'Late dispatch rate warning on Seller Central', description: 'Account Health shows late dispatch rate 4.6% for the last 7 days. Please check and advise.', priority: 'P2' });
const nehaId = (await get('/admin/staff', kabir)).find((s) => s.email === 'neha@demo.solluna.co.in').id;
await call('PATCH', `/ops/tickets/${t1.id}`, kabir, { assigneeId: nehaId });
await call('PATCH', `/ops/tickets/${t1.id}`, neha, { status: 'IN_PROGRESS' });
await call('POST', `/ops/tickets/${t1.id}/comments`, neha, { body: 'Internal: 6 orders shipped after SLA (courier pickup missed).', internal: true });
await call('PATCH', `/ops/tickets/${t1.id}`, neha, { status: 'WAITING_FOR_CLIENT', note: 'Pickups were missed on 3 days. Can you confirm your packing cut-off time so we can move label processing earlier?' });

// Amit (Reseller, Maharashtra): out-of-plan ads request, new Flipkart listing, ticket
await call('POST', '/requests', amit, { featureKey: 'ADS_MANAGEMENT', title: 'Run ads for pressure cookers', marketplace: 'AMAZON' });
await call('POST', '/requests', amit, { featureKey: 'NEW_LISTING_FLIPKART', title: 'List 3-litre steel pressure cooker' });
await call('POST', '/tickets', amit, { category: 'NEW_LISTING', marketplace: 'FLIPKART', subject: 'Status of pressure cooker listing', description: 'Requested a Flipkart listing for our 3L pressure cooker — what is the status?', priority: 'P3' });

// Kavya (Premium, Karnataka): marketplace, approved thank-you design, labels with inserts, a design in client review
await call('PUT', '/marketplaces/AMAZON', kavya, { hasAccount: true, storeName: 'Kavya Crafts', sellerId: 'A1KAVYA777' });
await call('PATCH', `/ops/clients/${kavyaOrg}/marketplaces/AMAZON`, kabir, { status: 'CONNECTED', note: 'Demo: user permission accepted in Seller Central' });
const design = { name: 'Festive insert', brandName: 'Kavya Crafts', message: 'Thank you for bringing home a piece made by hand in Channapatna.\nWe hope it brings colour to your home.', supportContact: 'care@kavyacrafts.example', website: 'https://kavyacrafts.example', colors: { primary: '#8A3B12', background: '#FFF8EE', text: '#2B1A10' }, widthMm: 100, heightMm: 150 };
const tpl = await call('POST', `/ops/clients/${kavyaOrg}/thank-you`, kabir, design);
await call('POST', `/ops/thank-you/${tpl.id}/submit`, kabir);
await call('POST', `/thank-you/${tpl.id}/decision`, kavya, { decision: 'APPROVE' });
await form(`/ops/clients/${kavyaOrg}/labels`, kabir, 'labels.pdf', PDF, { marketplace: 'AMAZON', batchDate: today, orderCount: 6, dispatchBy: `${today}T14:00:00+05:30` });
const v2 = await call('POST', `/ops/clients/${kavyaOrg}/thank-you`, kabir, { ...design, name: 'Everyday insert', message: 'Thank you for supporting handmade. Questions? Write to us any time.' });
await call('POST', `/ops/thank-you/${v2.id}/submit`, kabir);

// Website enquiry
await call('POST', '/public/contact', null, { name: 'Harsh Patel (Demo)', email: 'harsh@demo.solluna.co.in', phone: '9879012345', business: 'Patel Steelware', topic: 'PLANS', message: 'We have 80 SKUs on Flipkart and want to start Amazon. Which plan fits, and can you map our existing listings?' });

console.log('WORKFLOWS OK');
