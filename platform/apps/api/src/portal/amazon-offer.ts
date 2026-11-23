import type { Page } from 'playwright-core';

/**
 * Amazon "Add offer" recipe (learned live 23 Nov 2026 on Seller Central India).
 * Flow: /interactive/listing/workflow/offer?asin=ASIN&conditionType=new → "Add price and inventory" (Katal web components,
 * inside shadow DOM; Playwright CSS selectors pierce it). Fields match the client's Amazon mapping form (owner's list, 7 Nov).
 */
export const offerUrl = (asin: string) => `https://sellercentral.amazon.in/interactive/listing/workflow/offer?asin=${asin}&conditionType=new`;

const SKU = 'kat-input[name="contribution_sku-0-value"]';
const HSN = 'kat-input[name="external_product_information-0-value"]';
const HSN_ENTITY = 'kat-dropdown[name="external_product_information-0-entity"]';
const PRICE = 'kat-input[name="purchasable_offer[audience=ALL]-0-our_price-0-schedule-0-value_with_tax"]';
const MRP = 'kat-input[name="purchasable_offer[audience=ALL]-0-maximum_retail_price-0-schedule-0-value_with_tax"]';
const FBA = 'kat-radiobutton[data-testid="mewtwoMedeaBoolean-AMAZON_IN"]';
const MFN = 'kat-radiobutton[data-testid="mewtwoMedeaBoolean-DEFAULT"]';
const B2B = 'kat-toggle[data-testid="audiencesToggle-B2B"]';
export const SUBMIT = 'kat-button#form-submit-button';

export interface AmazonValues { sku: string; hsn?: string; fulfilmentChannel?: string; sellingPrice?: string; mrp?: string; audience?: string }

/** Opens the offer form; a clear reason when Amazon blocks it (permission, brand/category approval, already selling). */
export async function openOffer(page: Page, asin: string) {
  await page.goto(offerUrl(asin), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const ok = await page.locator(SKU).first().waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false);
  if (ok) { await page.waitForTimeout(2000); return; }
  const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  if (/access required|right permissions/i.test(text)) throw new Error('Amazon: SOLLUNA user lacks the "Inventory → Manage Inventory/Add a Product" permission on this seller account');
  if (/apply to sell|approval required|requires approval|listing limitations/i.test(text)) throw new Error(`Amazon: this ASIN needs category or brand approval before the seller can list it (${asin})`);
  if (/you already have an offer|already listed/i.test(text)) throw new Error(`Amazon: this seller already has an offer on ${asin}`);
  throw new Error(`Amazon: the offer form did not open for ${asin}`);
}

/** Katal kat-input: a hidden light-DOM input shadows the real one, so click the component and type with the keyboard. */
async function type(page: Page, sel: string, v: string) {
  const host = page.locator(sel).first();
  await host.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  await host.click({ timeout: 10_000 });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(v, { delay: 30 });
  await page.keyboard.press('Tab');
  const got = await host.evaluate((el: any) => String(el.value ?? '')).catch(() => '');
  if (got.trim() !== v.trim()) throw new Error(`Typed "${v}" but the box shows "${got}"`);
}

/** Fills the offer; returns what was entered and what could not be (the run stops before Submit if anything is missing). */
export async function fillOffer(page: Page, v: AmazonValues) {
  const filled: { field: string; value: string }[] = [];
  const missing: { field: string; reason: string }[] = [];
  const step = async (field: string, value: string | undefined, run: () => Promise<void>) => {
    if (value === undefined || value === '') { missing.push({ field, reason: 'Empty in the client form' }); return; }
    try { await run(); filled.push({ field, value }); } catch (e) { missing.push({ field, reason: (e as Error).message.split('\n')[0].slice(0, 160) }); }
  };
  await step('SKU', v.sku, () => type(page, SKU, v.sku));
  await step('External Product Information (HSN)', v.hsn, async () => {
    const entity = await page.locator(HSN_ENTITY).first().getAttribute('value').catch(() => null);
    if (entity && !/hsn/i.test(entity)) throw new Error(`Entity is "${entity}", expected HSN Code`);
    await type(page, HSN, v.hsn!);
  });
  const fba = /FBA|Fulfilled by Amazon/i.test(v.fulfilmentChannel ?? '');
  await step('Fulfillment Channel', v.fulfilmentChannel, async () => { await page.locator(fba ? FBA : MFN).first().click({ timeout: 10_000 }); await page.waitForTimeout(1500); });
  await step('Your Price', v.sellingPrice, () => type(page, PRICE, v.sellingPrice!));
  await step('Maximum Retail Price', v.mrp, () => type(page, MRP, v.mrp!));
  if (/B2B|Business/i.test(v.audience ?? '')) {
    await step('Audience: Amazon Business (B2B)', 'on', async () => {
      const t = page.locator(B2B).first();
      if ((await t.getAttribute('checked')) === null) await t.click({ timeout: 10_000 });
    });
  }
  return { filled, missing };
}

/** Required fields Amazon added after our values (e.g. a quantity box) that are still empty, and visible error messages. */
export async function offerProblems(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const walk = (root: any) => {
      for (const el of Array.from(root.querySelectorAll('*')) as any[]) {
        if (el.shadowRoot) walk(el.shadowRoot);
        const tag = el.tagName.toLowerCase();
        if (tag === 'kat-alert' && /danger|error|warning/.test(el.getAttribute('variant') ?? '')) out.push(`Alert: ${(el.getAttribute('header') ?? '') + ' ' + (el.textContent ?? '')}`.trim().slice(0, 200));
        if ((tag === 'kat-input' || tag === 'kat-textarea') && el.getAttribute('state') === 'error') out.push(`${el.getAttribute('name')}: ${(el.getAttribute('constraint-message') ?? 'error').slice(0, 120)}`);
      }
    };
    walk(document);
    return out;
  }).catch(() => [] as string[]);
}
