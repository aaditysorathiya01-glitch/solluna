import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { chromium, type Browser, type Page } from 'playwright-core';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { config } from '../common/config';
import { parse } from '../common/zod';
import { OpsMailService } from '../ops-mail/ops-mail.service';
import type { AuthUser } from '../auth/auth.types';

/**
 * SOLLUNA portal bot, stage 1 (owner, 21 Nov 2026): a remote browser on Browserbase (no Chromium on our server), driven
 * with Playwright. The "probe" runs a short list of steps and returns a screenshot and the clickable elements after each
 * one, so the real Seller Hub / Seller Central flows can be learned safely before the mapping bot runs on its own.
 * Safeguards (CLAUDE.md rule 6): super admin only; secrets are referenced by name and filled by the server, never
 * returned; bank / payment / settlement / user-settings pages are blocked; captchas are NOT solved; every run is audited.
 */
const BB = 'https://api.browserbase.com/v1';
const BLOCKED = /(bank|payment|settlement|payout|manage-?users|user-?permissions|account-?settings\/(users|password))/i;
const SECRETS: Record<string, () => string | undefined> = {
  OPS_EMAIL: () => config.opsUser.email,
  OPS_FLIPKART_PASSWORD: () => process.env.OPS_FLIPKART_PASSWORD,
  OPS_AMAZON_PASSWORD: () => process.env.OPS_AMAZON_PASSWORD,
};

const Step = z.union([
  z.object({ login: z.enum(['FLIPKART']) }),
  z.object({ clickAt: z.object({ x: z.number().min(0).max(2000), y: z.number().min(0).max(2000) }) }),
  z.object({ inspect: z.string().min(1).max(100) }),
  z.object({ hover: z.string().min(1).max(300) }),
  z.object({ fields: z.literal(true) }),
  z.object({ type: z.string().min(1).max(300), value: z.string().max(300) }),
  // OTP first: a union picks the first matching shape, and the plain fill would swallow it.
  z.object({ otp: z.enum(['FLIPKART', 'AMAZON']), fill: z.string().min(1).max(300) }),
  z.object({ goto: z.string().url() }),
  z.object({ click: z.string().min(1).max(300) }),
  z.object({ fill: z.string().min(1).max(300), value: z.string().max(300).optional(), secret: z.enum(['OPS_EMAIL', 'OPS_FLIPKART_PASSWORD', 'OPS_AMAZON_PASSWORD']).optional() }),
  z.object({ press: z.string().max(30) }),
  z.object({ wait: z.number().int().min(100).max(20_000) }),
]);
const ProbeSchema = z.object({ steps: z.array(Step).min(1).max(15), profile: z.enum(['ops-flipkart', 'ops-amazon']).default('ops-flipkart') });

interface Shot { step: string; url: string; title: string; png: string; elements: string[]; error?: string; html?: string }
interface Job { id: string; status: 'RUNNING' | 'DONE' | 'FAILED'; shots: Shot[]; error?: string; startedAt: Date }

@Injectable()
export class PortalBotService {
  private readonly log = new Logger('PortalBot');
  private readonly jobs = new Map<string, Job>();
  constructor(private readonly audit: AuditService, private readonly mail: OpsMailService) {}

  get configured() { return Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID); }

  private async bb<T>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${BB}${path}`, { method: body ? 'POST' : 'GET', headers: { 'x-bb-api-key': process.env.BROWSERBASE_API_KEY!, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    const text = await r.text();
    if (!r.ok) throw new ServiceUnavailableException(`Browserbase ${r.status}: ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** One persistent Browserbase context per ops login (cookies kept, fewer OTPs). */
  private contexts = new Map<string, string>();
  private async contextFor(profile: string) {
    const env = process.env[`BROWSERBASE_CONTEXT_${profile.replace('-', '_').toUpperCase()}`];
    if (env) return env;
    if (!this.contexts.has(profile)) this.contexts.set(profile, (await this.bb<{ id: string }>('/contexts', { projectId: process.env.BROWSERBASE_PROJECT_ID })).id);
    return this.contexts.get(profile)!;
  }

  async startProbe(user: AuthUser, input: unknown) {
    if (!this.configured) throw new BadRequestException('Add BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in the server environment.');
    const d = parse(ProbeSchema, input);
    for (const s of d.steps) if ('goto' in s && BLOCKED.test(s.goto)) throw new BadRequestException('That page is blocked for the bot (bank / payment / user settings).');
    const job: Job = { id: randomUUID(), status: 'RUNNING', shots: [], startedAt: new Date() };
    this.jobs.set(job.id, job);
    await this.audit.log({ actor: user, action: 'portal_bot.probe', entity: 'PortalBot', entityId: job.id, after: { profile: d.profile, steps: d.steps.map((s) => Object.keys(s)[0]) } });
    void this.runProbe(job, d).catch((e) => { job.status = 'FAILED'; job.error = (e as Error).message; });
    return { id: job.id, status: job.status };
  }

  getProbe(id: string) {
    const j = this.jobs.get(id);
    if (!j) throw new NotFoundException('Probe not found (server restarted?)');
    return j;
  }

  private async runProbe(job: Job, d: z.infer<typeof ProbeSchema>) {
    const contextId = await this.contextFor(d.profile);
    const session = await this.bb<{ id: string; connectUrl: string }>('/sessions', {
      projectId: process.env.BROWSERBASE_PROJECT_ID, region: 'ap-southeast-1',
      browserSettings: { context: { id: contextId, persist: true }, solveCaptchas: false, recordSession: false, viewport: { width: 1366, height: 860 } },
    });
    let browser: Browser | undefined;
    try {
      browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
      const ctx = browser.contexts()[0];
      let page = ctx.pages()[0] ?? await ctx.newPage();
      // Links that open a new tab: follow the newest tab (blocked pages are closed at once).
      const guard = (p: Page) => p.on('framenavigated', (f) => { if (f === p.mainFrame() && BLOCKED.test(f.url())) void p.close().catch(() => undefined); });
      guard(page);
      ctx.on('page', (p) => { guard(p); page = p; });
      const started = new Date();
      for (const s of d.steps) {
        const label = JSON.stringify('fill' in s && ('secret' in s || 'otp' in s) ? { ...s, value: undefined } : s).slice(0, 200);
        let error: string | undefined;
        let inspected: string | undefined;
        await this.dismissPopups(page);
        const act = async () => {
          if ('login' in s) await this.flipkartLogin(page);
          else if ('clickAt' in s) await page.mouse.click(s.clickAt.x, s.clickAt.y);
          else if ('fields' in s) inspected = await page.evaluate(() => {
            // Every form control with its visible label, name, type, required flag and the options of selects.
            const rows: string[] = [];
            for (const el of Array.from(document.querySelectorAll("input, select, textarea")) as any[]) {
              const r = el.getBoundingClientRect(); if (r.width < 2 && r.height < 2 && el.type !== 'hidden') continue;
              if (el.type === 'hidden') continue;
              const row = el.closest('div[class*="row"], div[class*="Row"], tr, li, .form-group') ?? el.parentElement?.parentElement;
              const label = (row?.querySelector('label')?.textContent ?? row?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 70);
              const opts = el.tagName === 'SELECT' ? ` options=[${Array.from(el.options).map((o: any) => o.text.trim()).slice(0, 12).join(' | ')}]` : '';
              rows.push(`${label} => ${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ''}${el.name ? ` name=${el.name}` : ''}${el.id ? ` #${el.id}` : ''}${opts}`);
            }
            return rows.join('\n');
          });
          else if ('hover' in s) await this.target(page, s.hover).hover({ timeout: 15_000 });
          else if ('type' in s) { const t = this.target(page, s.type); await t.click(); await t.fill(''); await t.pressSequentially(s.value, { delay: 60 }); }
          else if ('inspect' in s) inspected = await page.evaluate((t) => {
            const all = Array.from(document.querySelectorAll('body *')).filter((e) => (e as HTMLElement).innerText?.trim() === t);
            return all.slice(0, 3).map((e) => (e.parentElement?.parentElement ?? e).outerHTML.slice(0, 1500)).join('\n---\n');
          }, s.inspect);
          else if ('goto' in s) await page.goto(s.goto, { waitUntil: 'domcontentloaded', timeout: 45_000 });
          else if ('otp' in s) {
            const code = await this.mail.waitForOtp(s.otp, started);
            if (!code) throw new Error('No OTP arrived in the ops mailbox within 2 minutes');
            // Flipkart shows one box per digit; a single field gets the whole code.
            const boxes = page.locator(s.fill);
            const n = await boxes.count();
            if (n >= code.length) for (let i = 0; i < code.length; i++) await boxes.nth(i).fill(code[i]);
            else await this.target(page, s.fill).fill(code);
          } else if ('fill' in s) {
            const v = s.secret ? SECRETS[s.secret]?.() : s.value;
            if (v == null) throw new Error(`${s.secret ?? 'value'} is not set`);
            await this.target(page, s.fill).fill(v);
          } else if ('click' in s) await this.target(page, s.click).click({ timeout: 15_000 });
          else if ('press' in s) await page.keyboard.press(s.press);
          else if ('wait' in s) await page.waitForTimeout(s.wait);
        };
        try {
          // A Seller Hub popup can open a moment after the check; close it and retry the step once.
          try { await act(); } catch (first) {
            if (!('type' in s || 'click' in s || 'hover' in s || 'fill' in s)) throw first;
            await page.waitForTimeout(1500); await this.dismissPopups(page); await act();
          }
          await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
          await page.waitForTimeout(1200);
        } catch (e) { error = (e as Error).message.split('\n')[0].slice(0, 300); }
        job.shots.push({ step: label, url: page.url(), title: await page.title().catch(() => ''), png: (await page.screenshot({ type: 'png' }).catch(() => Buffer.alloc(0))).toString('base64'), elements: await this.elements(page), error, html: inspected });
        if (error) break;
      }
      job.status = 'DONE';
    } finally {
      await browser?.close().catch(() => undefined);
      await this.bb(`/sessions/${session.id}`, { projectId: process.env.BROWSERBASE_PROJECT_ID, status: 'REQUEST_RELEASE' }).catch(() => undefined);
    }
  }

  /**
   * Signs the ops user in to Flipkart Seller Hub if needed (learned 21 Nov 2026): Login → username → Next → password →
   * Enter → 6 one-digit OTP boxes, OTP read from the ops mailbox. A saved session skips straight to the dashboard.
   */
  private async flipkartLogin(page: Page) {
    await page.goto('https://seller.flipkart.com/index.html#dashboard/home-page', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4000);
    if (page.url().includes('#dashboard') && !page.url().includes('referral_url')) return;
    const started = new Date();
    await page.locator('button:has-text("Login")').first().click({ timeout: 15_000 });
    await page.locator('input[name=username]').fill(config.opsUser.email);
    await page.locator('button:has-text("Next")').first().click();
    const pw = process.env.OPS_FLIPKART_PASSWORD;
    if (!pw) throw new Error('OPS_FLIPKART_PASSWORD is not set');
    await page.locator('input[name=password]').fill(pw, { timeout: 15_000 });
    await page.keyboard.press('Enter');
    const boxes = page.locator('input[type=tel]');
    const otpAsked = await boxes.first().waitFor({ timeout: 12_000 }).then(() => true).catch(() => false);
    if (otpAsked) {
      const code = await this.mail.waitForOtp('FLIPKART', started);
      if (!code) throw new Error('Flipkart asked for an OTP but none reached the ops mailbox in 2 minutes');
      for (let i = 0; i < code.length; i++) await boxes.nth(i).fill(code[i]);
    }
    await page.waitForURL(/#dashboard/, { timeout: 30_000 });
  }

  /** Known Seller Hub popups (notification prompt, tutorial video, "New Listings Page") are closed before each step. */
  private async dismissPopups(page: Page) {
    const quick = { timeout: 600 };
    await page.locator('#moe-dontallow_button').click(quick).catch(() => undefined);
    // "New Listings Page! What are its benefits?" ignores Escape; its only button closes the tour (no setting changes).
    if (await page.getByText('What are its benefits?').isVisible().catch(() => false)) await page.getByRole('button', { name: 'View the new page' }).click(quick).catch(() => undefined);
    if (await page.getByText('Learn To Do Single Listing').isVisible().catch(() => false)) await page.getByRole('button', { name: 'Close' }).last().click(quick).catch(() => undefined);
  }

  /** "text=Login", "role=button[name=Next]" or any Playwright selector; plain words match visible text. */
  private target(page: Page, sel: string) {
    if (/^(text=|role=|css=|xpath=|#|\.|\[|input|button|a\b|div|span)/.test(sel)) return page.locator(sel).first();
    return page.getByText(sel, { exact: false }).first();
  }

  /** Visible inputs, buttons and links (what a person could click), for learning the flow. */
  private async elements(page: Page) {
    return page.evaluate(() => {
      const out: string[] = [];
      const els = Array.from(document.querySelectorAll('input, button, a, select, textarea, [role=button]')) as HTMLElement[];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const tag = el.tagName.toLowerCase();
        const i = el as HTMLInputElement;
        const name = (el.getAttribute('aria-label') || i.placeholder || el.innerText || i.name || el.id || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        out.push(`${tag}${i.type ? `[${i.type}]` : ''}${el.id ? `#${el.id}` : ''}${i.name ? `[name=${i.name}]` : ''} "${name}"`);
        if (out.length >= 60) break;
      }
      return out;
    }).catch(() => []);
  }
}
