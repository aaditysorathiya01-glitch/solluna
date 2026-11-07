# Open discussions — decide later

Parked topics with the options already worked out. Nothing here is live unless marked. Updated 7 Nov 2026.

## 1. Product details from a link (Listings & Mapping forms)
**Now (live):** clients fill product details manually; templates prefill repeat products ("Save template & submit"). The link's ASIN / FSN is detected and sent to the manager.
**Built but switched off:** online auto-fill (Claude web search + web fetch, background job, 7-day reuse, daily limit). It turns on only when `ANTHROPIC_API_KEY` is set on the server; without it the button stays hidden. Code: `platform/apps/api/src/catalog-forms/product-lookup.service.ts`.

| Option | Cost | Notes |
|---|---|---|
| A. "SOLLUNA fills product details" checkbox — client gives link + own data (SKU, price, stock), manager fills the rest | ₹0 | Not instant; ~2–5 min of manager time per product |
| B. Gemini API free tier with Google Search grounding | Free quota, then paid | Quota terms can change; free-tier data may be used by Google |
| C. Free search APIs (Google 100/day, Brave 2,000/month) | ₹0 | Only names / images, no structured details — not enough |
| D. Amazon SP-API Catalog Items | ₹0 | Official Amazon data after SP-API approval; not for Flipkart |
| E. Claude API (switch on the built feature; `LOOKUP_MODEL=claude-haiku-5-5`, 3 searches) | ~₹300–800 / month | Best auto-fill; set a monthly spend limit in the Anthropic Console |

Note: a Claude Pro subscription cannot power a server feature for clients — app use needs an API key with separate billing.
Checked and rejected: the GitHub "public-apis" list (github.com/public-apis/public-apis) is a directory of free APIs, not a product-data source — no Amazon.in / Flipkart product details, HSN or manufacturer data; barcode APIs there cover mostly US/EU products. Amazon Product Advertising API and the Flipkart Affiliate API give product titles/images for free, but their terms are for affiliate promotion and need ongoing affiliate sales — not a safe basis for filling seller listings. SP-API Catalog (option D) remains the free, seller-approved route.
Recommendation when revisited: A now, D once SP-API is approved, E only if instant auto-fill proves worth paying for.

## 2. Remaining listing forms
Amazon Mapping, Flipkart New listing and Amazon New listing are drafts (marked "Draft form"). Owner to send the field lists, as done for Flipkart Mapping. Schema: `platform/packages/catalog-forms/src/index.ts`.

## 3. Label cropper — "Auto + specialised" (Premium)
Current placeholder: item line, SKU sorting and picklist page. Owner has a different idea for specialised — to be shared. Manual crop is frozen (owner-approved 6 Nov 2026).

## 4. Marketplace access
Decided: managed user access now + API applications in parallel. Pending: Seller Central "User Permissions" screenshot for the onboarding guide; Amazon SP-API (public developer), Amazon Ads API and Flipkart API applications (drafts to prepare).
