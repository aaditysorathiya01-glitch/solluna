// Smoke test: the installed pieces start and work together on this machine (no marketplace, no real model call).
import { createServer } from 'node:http';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { Stagehand } from '@browserbasehq/stagehand';
import { PgBoss } from 'pg-boss';

const exe = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const results = [];
const ok = (name, detail = '') => { results.push(['PASS', name, detail]); console.log('PASS', name, detail); };
const fail = (name, e) => { results.push(['FAIL', name, String(e?.message ?? e)]); console.log('FAIL', name, e?.message ?? e); };

// A tiny "portal" page with a login form and a download link.
const site = createServer((req, res) => {
  if (req.url === '/report.csv') { res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="report.csv"' }); return res.end('sku,qty\nA1,2\n'); }
  res.writeHead(200, { 'content-type': 'text/html' }).end(`<html><body><h1>Seller portal</h1>
    <form onsubmit="event.preventDefault();document.body.dataset.in='1';document.getElementById('r').hidden=false">
      <input id="email" placeholder="Email"><input id="pw" type="password"><button>Sign in</button></form>
    <a id="r" href="/report.csv" hidden>Download report</a></body></html>`);
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${site.address().port}/`;

// 1. Playwright: persistent profile, form, download.
try {
  const profile = mkdtempSync(join(tmpdir(), 'bot-profile-'));
  const ctx = await chromium.launchPersistentContext(profile, { executablePath: exe, headless: true, acceptDownloads: true });
  await ctx.tracing.start({ screenshots: true, snapshots: true });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto(url);
  await page.fill('#email', 'ops@solluna.co.in'); await page.fill('#pw', 'x'); await page.click('button');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#r')]);
  const file = join(profile, 'report.csv'); await dl.saveAs(file);
  const trace = join(profile, 'trace.zip'); await ctx.tracing.stop({ path: trace });
  await ctx.close();
  if (!existsSync(file) || !existsSync(trace)) throw new Error('download or trace missing');
  ok('playwright-core', 'login form + file download + trace recording');
} catch (e) { fail('playwright-core', e); }

// 2. Stagehand (local mode, own model key, local action cache): starts the browser and drives the page without AI.
try {
  const sh = new Stagehand({
    env: 'LOCAL', disableAPI: true, verbose: 0, disablePino: true, selfHeal: true,
    cacheDir: mkdtempSync(join(tmpdir(), 'bot-cache-')),
    model: { modelName: 'anthropic/claude-haiku-5-5', apiKey: 'not-used-in-smoke-test' },
    localBrowserLaunchOptions: { executablePath: exe, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'bot-sh-')) },
  });
  await sh.init();
  const page = sh.context.pages()[0];
  await page.goto(url);
  const title = await page.locator('h1').textContent();
  await sh.close();
  if (title !== 'Seller portal') throw new Error(`unexpected page text: ${title}`);
  ok('stagehand', 'local mode init + navigation (AI calls need the real model key)');
} catch (e) { fail('stagehand', e); }

// 3. pg-boss: queue on our own Postgres (no Redis).
try {
  const boss = new PgBoss(process.env.BOSS_DATABASE_URL ?? 'postgresql://solluna:solluna@localhost:5432/solluna_bot_test');
  await boss.start();
  await boss.createQueue('portal-run');
  const done = new Promise((resolve) => boss.work('portal-run', async ([job]) => { resolve(job.data); }));
  await boss.send('portal-run', { client: 'demo', task: 'FLIPKART_PL_DOWNLOAD' });
  const data = await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('job not picked up in 15s')), 15000))]);
  await boss.stop({ graceful: false });
  if (data.task !== 'FLIPKART_PL_DOWNLOAD') throw new Error('wrong job data');
  ok('pg-boss', 'queue created, job sent and worked');
} catch (e) { fail('pg-boss', e); }

site.close();
console.log(JSON.stringify(results));
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
