# Open discussions — decide later

Parked topics with the options already worked out. Nothing here is live unless marked. Updated 7 Nov 2026.

## 1. Product details from a link (Listings & Mapping forms)
**Decision (7 Nov 2026): stay manual — parked, revisit later.**
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
F. Free stack from the public-apis list (checked 7 Nov 2026, not yet tested live): ContextFetch (web search, no key) + TidyTools / ReplyNodes (page → text, no key, rate limited) + a free-tier LLM (Gemini / Groq / Mistral) to turn text into fields. ₹0 within limits, but three small third-party dependencies, marketplace pages often block such fetchers, and lower quality than E. Amazon "scraper" APIs on the list (Pangolinfo, Amazonscraperapi, ScrapingBot …) rely on scraping — rejected.

**Live test of option F — 7 Nov 2026, FSN `BCRFZTDTASCF3G6V`: FAILED, not deployed.**
| Step | Result |
|---|---|
| ReplyNodes (page → text) on the Flipkart product URL | Flipkart bot-block page ("Wow, looks like all of India is here!") |
| ContextFetch contents (page fetch) | `CRAWL_NOT_FOUND` — HTTP 429 from Flipkart |
| Microlink (metadata) | Flipkart homepage title only, no product data |
| ContextFetch search "BCRFZTDTASCF3G6V", "… flipkart", "pid=…" | 0 relevant results — the FSN is not in its index |
Conclusion: free fetchers are blocked by Flipkart and free search indexes don't know raw FSNs, so option F cannot fill the form. Only a search-grounded LLM (B or E) or official APIs (D / Flipkart API) can.
India GST HSN API (gst-hsn-sac-api.vercel.app) tested live: HSN search works, no GST rates — usable as an HSN-finder helper only.

Recommendation when revisited: A now, D once SP-API is approved, E only if instant auto-fill proves worth paying for.

### Free helper APIs from the same list (low risk, candidates to build)
| API (public-apis list) | Use | Key |
|---|---|---|
| India GST HSN & SAC | HSN search + GST rate in the listing forms ("Find relevant HSN codes") | No |
| Indian Pincode / PostalPinCode | PIN → city, district, state in billing and seller-account addresses | No |
| gstinapi | GSTIN → legal name, status, address at billing / sign-up | Free tier, key needed |
| Razorpay IFSC | IFSC → bank and branch (future bank details) | No |
Each must be tested live before use, with the form working manually if the API is down.

## 2. Listings & Mapping section — PARKED (owner, 7 Nov 2026)
Whole section moved to discussion: forms need to be designed category-wise (each Flipkart vertical / Amazon product type has its own attributes). The four current forms stay live as they are until then; no further changes without owner sign-off.

Current state — all four forms final for the owner's example categories:
Flipkart Mapping, Flipkart New listing (5 images), Amazon Mapping (condition New; audience = enable one or both) and Amazon New listing (9 images; condition New; no pricing rule) follow the owner's Seller Hub / Seller Central field lists. Schema: `platform/packages/catalog-forms/src/index.ts`.
Open points:
- New-listing attributes follow the owner's example category (Flipkart: cleaners; Amazon: Bonding Adhesives). Other verticals / product types have different attributes — decide whether to add per-category attribute sets.
- Dropdowns whose exact marketplace values were not shared are typing suggestions (any value accepted) until the lists are shared.
- Amazon New listing has no "Item Name" field (not in the owner's list): the product is named "Brand + Model Number" and the manager writes the final title.

## 2a. Auto-fill the Flipkart New listing page with AI
Owner (7 Nov 2026): the New listing form is fine for now; work out later how AI can fill it (vertical, attributes, key features, description, search keywords, HSN/tax from product images + a reference link). Same options and costs as section 1 (Claude / Gemini with search, SP-API not applicable to Flipkart). Until then the client fills it manually or from a template.

## 3. Label cropper — "Auto + specialised" (Premium)
Current placeholder: item line, SKU sorting and picklist page. Owner has a different idea for specialised — to be shared. Manual crop is frozen (owner-approved 6 Nov 2026).

## 4. Marketplace access
Decided 7 Nov 2026 (owner): option B — clients "Add a new user" (one SOLLUNA ops ID for all); interim seller-portal automation with that login until APIs are approved; clients accept Terms §6 at purchase. Plan and pending inputs: `docs/plans/SELLER_PORTAL_AUTOMATION.md`. API applications (Amazon SP-API, Ads API, Flipkart Seller API) still to be prepared and submitted.
Open: whether the client-facing manager is labelled as AI in chat (owner to decide).
