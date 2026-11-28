import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import type { Page } from 'playwright-core';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AGENT_MODEL, PRICE } from '../chat/manager-agent.service';
import type { AuthUser } from '../auth/auth.types';
import { PortalBotService } from './portal-bot.service';

/**
 * Flipkart new listing by the portal bot (owner, 28 Nov 2026), built step by step as the owner teaches it.
 * Step 1 — vertical: Seller Hub → Add a Single Listing (#dashboard/addListings/single) → type in "Enter Product Name…" →
 * Flipkart suggests full paths ("Home Decor / Lights & Lamps / Bulb"). The client's vertical is tried first; an exact
 * match (last part of the path) is taken as is. Otherwise more suggestions are gathered from the product name and Haiku
 * picks the nearest one from Flipkart's own list (it can only choose, never invent). Then "Select Brand" must appear.
 * Step 2 — brand: exactly what the client wrote (full brand name).
 */
const SINGLE = 'https://seller.flipkart.com/index.html#dashboard/addListings/single';
const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** "Bulbs" = "Bulb", "Floor Cleaners" = "Floor Cleaner". */
const same = (a: string, b: string) => { const x = norm(a), y = norm(b); const sing = (s: string) => s.replace(/(es|s)$/,''); return x === y || sing(x) === sing(y); };
const last = (path: string) => path.split('/').pop()!.trim();

export interface VerticalChoice { path: string; source: 'exact' | 'nearest'; reason: string; candidates: string[] }

@Injectable()
export class FlipkartListingService {
  private readonly log = new Logger('FlipkartListingBot');
  constructor(private readonly db: PrismaService, private readonly audit: AuditService, private readonly bot: PortalBotService) {}

  private async form(requestId: string) {
    const f = await this.db.catalogForm.findFirst({ where: { requestId, marketplace: 'FLIPKART', kind: 'NEW_LISTING' }, orderBy: { createdAt: 'desc' } });
    if (!f) throw new NotFoundException('No Flipkart new listing form for this request');
    const d = f.data as Record<string, unknown>;
    const str = (k: string) => (d[k] === undefined || d[k] === null ? '' : String(d[k]).trim());
    return { orgId: f.organizationId, vertical: str('vertical'), brand: str('brand'), title: str('productTitle'), description: str('productDescription'), sku: str('sellerSku'), data: d };
  }

  /**
   * Super admin preview of what is built so far: the bot picks the vertical and stops (nothing is created on Flipkart
   * beyond choosing a category on the page). Result and screenshot are kept as a PortalRun.
   */
  async preview(user: AuthUser, requestId: string) {
    const f = await this.form(requestId);
    const run = await this.db.portalRun.create({ data: { organizationId: f.orgId, requestId, kind: 'FLIPKART_NEW_LISTING', status: 'RUNNING', input: { mp: 'FLIPKART', sku: f.sku, title: f.title, values: { vertical: f.vertical, brand: f.brand } } as Prisma.InputJsonValue } });
    await this.audit.log({ actor: user, action: 'portal_bot.new_listing_preview', entity: 'PortalRun', entityId: run.id, organizationId: f.orgId, after: { requestId } });
    void this.runPreview(run.id, f).catch((e) => this.log.error(e));
    return { id: run.id, status: run.status };
  }

  /** Super admin: try the vertical choice with any values (no request needed), e.g. "bulb" + a product name. */
  async tryVertical(user: AuthUser, body: { organizationId?: string; vertical?: string; title?: string; description?: string }) {
    const orgId = String(body?.organizationId ?? '');
    if (!orgId || !body?.vertical) throw new BadRequestException('organizationId and vertical are required');
    const f = { orgId, vertical: String(body.vertical).slice(0, 120), brand: '', title: String(body.title ?? '').slice(0, 200), description: String(body.description ?? '').slice(0, 3000), sku: '', data: {} };
    const run = await this.db.portalRun.create({ data: { organizationId: orgId, kind: 'FLIPKART_NEW_LISTING', status: 'RUNNING', input: { mp: 'FLIPKART', sku: '', title: `try: ${f.vertical} / ${f.title}`, values: { vertical: f.vertical } } as Prisma.InputJsonValue } });
    await this.audit.log({ actor: user, action: 'portal_bot.new_listing_try', entity: 'PortalRun', entityId: run.id, organizationId: orgId, after: { vertical: f.vertical, title: f.title } });
    void this.runPreview(run.id, f).catch((e) => this.log.error(e));
    return { id: run.id, status: run.status };
  }

  private async runPreview(id: string, f: Awaited<ReturnType<FlipkartListingService['form']>>) {
    const shots: { step: string; png: string }[] = [];
    let close: (() => Promise<void>) | undefined;
    try {
      const opened = await this.bot.openPage('ops-flipkart');
      close = opened.close;
      const page = opened.holder.page;
      await this.bot.flipkartLogin(page);
      const v = await this.chooseVertical(page, f, id);
      const png = await page.screenshot({ type: 'png' }).catch(() => null);
      if (png) shots.push({ step: `Vertical: ${v.path}`, png: png.toString('base64') });
      const filled = [
        { field: 'Vertical', value: `${v.path} (${v.source === 'exact' ? 'client’s vertical, exact match' : `nearest to “${f.vertical}”: ${v.reason}`})` },
        { field: 'Brand', value: `${f.brand} (as the client wrote it)` },
      ];
      await this.db.portalRun.update({ where: { id }, data: { status: 'PREVIEW', filled, missing: [], shots: shots as unknown as Prisma.InputJsonValue, error: `Built so far: vertical + brand. Candidates seen: ${v.candidates.slice(0, 12).join(' | ')}`.slice(0, 1000) } });
    } catch (e) {
      await this.db.portalRun.update({ where: { id }, data: { status: 'FAILED', error: (e as Error).message.split('\n')[0].slice(0, 500), shots: shots as unknown as Prisma.InputJsonValue } }).catch(() => undefined);
    } finally { await close?.(); }
  }

  /** Flipkart's suggestions for a search term (full paths). */
  private async suggest(page: Page, term: string) {
    const box = page.locator('input[placeholder^="Enter Product Name"]').first();
    await box.click({ timeout: 15_000 });
    await box.fill('');
    await box.pressSequentially(term.slice(0, 60), { delay: 40 });
    await page.waitForTimeout(2500);
    return (await page.locator('.typeAheadItemContainer li').allInnerTexts().catch(() => [])).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  async chooseVertical(page: Page, f: { vertical: string; title: string; description: string; orgId: string }, runId?: string): Promise<VerticalChoice> {
    await page.goto(SINGLE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('input[placeholder^="Enter Product Name"]').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await this.bot.dismissPopups(page);
    const found = new Map<string, string>(); // path → term that shows it
    const add = (term: string, list: string[]) => { for (const p of list) if (!found.has(p)) found.set(p, term); };
    add(f.vertical, await this.suggest(page, f.vertical));
    let path = [...found.keys()].find((p) => same(last(p), f.vertical));
    let source: VerticalChoice['source'] = 'exact';
    let reason = 'same name as the client wrote';
    if (!path) {
      // Not Flipkart's exact name: more candidates from the product name and the vertical's single words, then Haiku picks.
      const words = norm(f.vertical).split(' ').filter((w) => w.length > 2);
      for (const term of [f.title, ...words].filter(Boolean).slice(0, 4)) add(term, await this.suggest(page, term));
      const candidates = [...found.keys()].slice(0, 60);
      if (!candidates.length) throw new Error(`Flipkart shows no vertical for “${f.vertical}” or the product name; the team must pick it`);
      const pick = await this.nearest(f, candidates, runId);
      if (!pick) throw new Error(`No suitable Flipkart vertical for “${f.vertical}” among: ${candidates.slice(0, 10).join(' | ')}`);
      path = pick.path; source = 'nearest'; reason = pick.reason;
    }
    // Select it: show the suggestion again and click that exact line, then Flipkart offers "Select Brand".
    await this.suggest(page, found.get(path)!);
    await page.locator('.typeAheadItemContainer li', { hasText: path }).filter({ hasText: new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().click({ timeout: 10_000 });
    await page.getByRole('button', { name: /select brand/i }).first().waitFor({ timeout: 20_000 });
    return { path, source, reason, candidates: [...found.keys()] };
  }

  /** Haiku chooses one of Flipkart's own paths (by number), or none. */
  private async nearest(f: { vertical: string; title: string; description: string; orgId: string }, candidates: string[], runId?: string) {
    if (!process.env.ANTHROPIC_API_KEY) throw new BadRequestException('ANTHROPIC_API_KEY is not set; the vertical cannot be chosen automatically');
    const list = candidates.map((c, i) => `${i + 1}. ${c}`).join('\n');
    const res = await new Anthropic().messages.create({
      model: AGENT_MODEL, max_tokens: 200,
      system: 'You pick the Flipkart category (vertical) for a product. Choose ONLY from the numbered list. Reply exactly: <number> | <short reason>. Reply 0 | <reason> if none fits.',
      messages: [{ role: 'user', content: `Seller's category: ${f.vertical}\nProduct name: ${f.title}\nDescription: ${f.description.slice(0, 1500)}\n\nFlipkart verticals:\n${list}` }],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(' ').trim();
    const cost = res.usage.input_tokens * PRICE.input + res.usage.output_tokens * PRICE.output;
    await this.db.agentRun.create({ data: { organizationId: f.orgId, status: 'DONE', model: AGENT_MODEL, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, costMicroUsd: Math.round(cost), note: 'listing vertical', finishedAt: new Date(), trace: { kind: 'listing_vertical', runId: runId ?? null, answer: text.slice(0, 300) } } });
    const m = /^(\d+)\s*\|?\s*(.*)$/s.exec(text);
    const n = m ? Number(m[1]) : 0;
    if (!n || n > candidates.length) return null;
    return { path: candidates[n - 1], reason: (m![2] || 'closest match').slice(0, 200) };
  }
}
