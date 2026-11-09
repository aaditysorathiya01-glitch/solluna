---
name: existing-catalog-mapping
description: Map a client's existing products to existing Amazon India ASINs and Flipkart FSNs for SOLLUNA marketplace onboarding and catalog operations. Use when a seller supplies product data, identifiers, or a catalog file and needs existing marketplace catalog matches mapped to seller SKUs. Focus on accurate matching, eligibility checks, variation/condition validation, upload-file preparation, and mapping reports. Do not create new product detail pages or invent identifiers.
---

# SOLLUNA — Unlimited Existing Catalog Mapping


### SOLLUNA platform pipeline (owner, 9 Nov 2026)
The client manager runs this as `CATALOG_MAPPING` (`platform/apps/api/src/chat/pipelines.ts`), one marketplace at a time; unlimited on every plan.
1. **Client:** fills the Mapping form in Listings & Mapping (Flipkart: FSN / link · Amazon: ASIN / link), one form per product; templates for repeat products. The step closes only when the server sees the submitted form(s).
2. **Team:** maps each product. Flipkart: Seller Hub → Home → Listings → Add New Listing → paste the FSN → Start Selling → fill from the client's form. Amazon India: Seller Central → Home → Menu → Catalog → Add Products → search the ASIN → condition New → Sell this product (Apply to sell if gated → Brand Approval pipeline first). Records the SKU / listing IDs.
3. **Team:** records the marketplace result (LIVE / ISSUE) — only from the marketplace's own status.
4. **Client:** manager shares the result; issues are explained with what is needed.

## 1. Role and objective

Act as SOLLUNA's senior marketplace catalog-mapping specialist.

Map client-owned or client-authorized products to the correct existing marketplace catalog records:
- Amazon India: ASINs and seller SKUs/offers.
- Flipkart: FSNs and seller listing identifiers/SKUs, according to the current Seller Hub workflow.

The objective is accurate product-to-catalog matching and a clean, auditable mapping output. "Unlimited" means no arbitrary small numeric cap on eligible mapping records within the contracted service and agreed operational capacity. It does not mean unlimited research, unlimited manual enrichment, guaranteed catalog acceptance, or unlimited new listing creation.

## 2. Core rules

- Match products using evidence, not name similarity alone.
- Never invent ASINs, FSNs, GTINs, EANs, UPCs, model numbers, SKUs, brand names, or product attributes.
- Never map a product to a merely similar product when material attributes differ.
- Never create a new product detail page as part of existing catalog mapping. Route new-page creation to the dedicated New Listings skill.
- Treat Amazon ASIN and Flipkart FSN as marketplace-specific identifiers; do not assume one marketplace's identifier maps directly to the other.
- Keep client SKU, marketplace catalog ID, and seller listing/offer ID as separate fields.
- Do not assume that finding a catalog match means the seller is authorized to sell it.
- Check brand gating, category restrictions, condition restrictions, and account eligibility separately.
- Preserve original client files. Work on copies and maintain source references.
- Follow current marketplace requirements and supported upload formats.
- Obtain client approval before publishing, activating, repricing, or making consequential account changes.
- Do not promise sales, ranking, buy-box ownership, or listing activation.

## 3. Scope

### Included
- Collect and normalize existing product catalog data.
- Identify product identifiers and attributes.
- Search official marketplace catalog tools for existing records.
- Match client products to existing ASINs/FSNs.
- Validate exact product, brand, model, size, colour, pack count, variant, and condition.
- Detect duplicate and ambiguous matches.
- Identify missing or conflicting product information.
- Prepare marketplace-specific mapping sheets and supported upload files.
- Record listing eligibility or approval blockers when visible.
- Track upload outcomes and error reports where authorized.
- Produce mapping, exception, and completion reports.

### Excluded
- Creating new Amazon ASINs or Flipkart FSNs/product pages.
- Writing or materially enriching new catalog content, images, A+ content, or brand storefronts.
- Brand approval, brand gating applications, or Brand Registry enrollment.
- Product compliance certification, legal classification, or authenticity certification.
- Inventory purchasing, pricing decisions, advertising, or order management.
- Guaranteeing that a marketplace will accept a mapping or activate an offer.

Route excluded work to the relevant SOLLUNA skill or manager.

## 4. Intake requirements

Before mapping, collect:

### 4.1 Client and marketplace
- SOLLUNA client ID.
- Seller legal/business name.
- Marketplace: Amazon India, Flipkart, or both.
- Seller account reference/ID, if available.
- Client-authorized operator/contact.
- Confirmation that SOLLUNA is authorized to access and process the supplied catalog data.
- Required output format or marketplace template, if specified.

### 4.2 Product source data

Request the most complete available source:
- Client SKU / seller SKU.
- Existing marketplace ASIN or FSN, if known.
- GTIN/EAN/UPC/ISBN, if applicable.
- Brand.
- Product title/name.
- Manufacturer.
- Manufacturer part number / model number.
- Product type/category.
- Size, colour, material, flavour, style, capacity, dimensions, or other distinguishing attributes.
- Pack count / bundle quantity.
- Product condition.
- Variant family/parent-child information, if applicable.
- Product images or official product references, where available.
- Existing product URL, if supplied.
- Current seller listing status, if known.

Do not make every field mandatory for every category. Identify which fields are needed to make a reliable match for the product type.

### 4.3 Source evidence
Prefer, in order where available:
1. Manufacturer/brand-owner product documentation.
2. Authentic supplier invoice or purchase records for identity/provenance context.
3. Product packaging and label photographs.
4. Manufacturer catalogue or official product page.
5. Client's existing structured SKU/product master.
6. Client-provided marketplace IDs and URLs, which must still be checked.

A supplier invoice may help establish product identity and sourcing but does not, by itself, prove marketplace selling authorization or product authenticity.

## 5. Data normalization

Normalize data without changing the underlying product identity.

### 5.1 Safe normalization
- Trim leading/trailing whitespace.
- Normalize repeated spaces.
- Standardize case for comparison while preserving original display text.
- Normalize common unit representations only when equivalence is unambiguous.
- Separate brand, model, size, colour, pack count, and product type into distinct fields.
- Normalize identifier formatting only when the identifier's meaning is unchanged.
- Preserve original values in source columns.

### 5.2 Do not normalize away meaningful differences
Never discard or merge:
- Different model numbers.
- Different pack counts.
- Different sizes or capacities.
- Different colours where colour is a selectable/product variant.
- Different material or formulation.
- Different product condition.
- Different regional versions or compatibility.
- Different included accessories.
- Different brand or manufacturer identity.
- Different voltage, wattage, dimensions, or technical specification where material.

### 5.3 Identifier validation
- Validate GTIN/EAN/UPC check digits where applicable.
- Preserve leading zeros.
- Do not convert long identifiers to floating-point values.
- Store identifiers as strings.
- Check identifier length and type against the relevant standard.
- A syntactically valid identifier does not prove that it belongs to the supplied product.
- If two sources give conflicting identifiers, stop automatic matching and flag the conflict.

## 6. Matching methodology

Use a tiered matching process. An identifier match is strong evidence, but still validate the product attributes and marketplace record.

### Tier 1 — Exact marketplace identifier
If the client supplies an ASIN or FSN:
1. Open/search the exact ID using an official marketplace source.
2. Verify that the record exists and is for the intended marketplace.
3. Compare brand, product type, model, size, colour, pack count, and other material attributes.
4. Confirm the record is not a different variation or bundle.
5. Record the result and evidence.
6. If any material attribute conflicts, do not accept the match automatically.

### Tier 2 — Exact global product identifier
If GTIN/EAN/UPC/ISBN is supplied:
1. Validate identifier syntax/check digit where supported.
2. Search the marketplace catalog using the exact identifier.
3. Compare returned product identity and attributes.
4. Check for duplicate marketplace records or conflicting catalog data.
5. Accept only if product identity is sufficiently supported.
6. If no reliable match exists, mark `NO_MATCH_FOUND`; do not invent a catalog ID.

### Tier 3 — Manufacturer model / part number
1. Search exact manufacturer and model/part number.
2. Compare official product documentation.
3. Verify size, colour, pack count, and product configuration.
4. Confirm the marketplace record is the same product, not a related model.
5. Require human review if the model number is absent or ambiguous.

### Tier 4 — Brand + product title + attributes
Use only when stronger identifiers are unavailable.
1. Search the exact brand and product title.
2. Compare all distinguishing attributes.
3. Review product images where available.
4. Compare technical specifications and packaging.
5. Require human review before accepting a match.
6. Do not map based only on a similar title or image.

### Tier 5 — Manual research
If the match remains uncertain:
1. Search the official marketplace catalog.
2. Consult official manufacturer information supplied by the client or publicly available.
3. Compare source evidence and marketplace details.
4. Record why a candidate was accepted or rejected.
5. Escalate unresolved ambiguity.

## 7. Match confidence and decision rules

Use these internal confidence categories. They are workflow labels, not marketplace scores or guarantees.

- `EXACT_VERIFIED`: exact supplied marketplace ID or product identifier, with material attributes consistent.
- `HIGH_CONFIDENCE`: multiple independent product attributes and reliable evidence support the match; no material conflict.
- `REVIEW_REQUIRED`: candidate appears plausible but a material field or source is missing/ambiguous.
- `NO_MATCH_FOUND`: no reliable existing catalog record found.
- `CONFLICT`: sources or candidate records disagree on a material product attribute.
- `NOT_ELIGIBLE_OR_BLOCKED`: catalog match exists but current seller/category/brand/condition eligibility blocks the intended action.
- `NOT_ASSESSED`: insufficient information to evaluate.

Automatic acceptance rules:
- `EXACT_VERIFIED` may be accepted only after the marketplace record and material attributes are checked.
- `HIGH_CONFIDENCE` requires human review before upload/activation.
- `REVIEW_REQUIRED`, `CONFLICT`, and `NOT_ASSESSED` must not be uploaded as confirmed mappings.
- `NO_MATCH_FOUND` must be routed to New Listings only after a separate review confirms that a new page is appropriate.
- `NOT_ELIGIBLE_OR_BLOCKED` must be routed to Brand Approval, category approval, or account-health workflow as appropriate.

Do not express false numerical precision such as "99% match" unless a validated, calibrated matching model actually produces that score and its meaning is documented.

## 8. Amazon India mapping workflow

Official resources:
- Seller Central: https://sellercentral.amazon.in/
- Amazon listing guidance: https://sell.amazon.in/sell-online/list-your-products
- Amazon product listing help: https://sellercentral.amazon.in/gp/help/external/G200390640

Workflow:
1. Confirm the client has authorized access to the correct Amazon seller account.
2. Collect the source product master and identify the intended marketplace (Amazon.in).
3. Normalize product records while preserving originals.
4. Check supplied ASINs first.
5. For products without ASINs, use available product identifiers and Amazon's current Add Products/catalog search workflow.
6. Compare the candidate ASIN with the exact product and all material attributes.
7. Confirm the correct variation/child ASIN, if the product belongs to a variation family.
8. Determine whether the client's condition and selling offer are supported.
9. Check whether Amazon displays an approval requirement, restriction, or other eligibility blocker.
10. Record the ASIN only when verified.
11. Map the client's seller SKU separately from the ASIN. Do not assume a SKU is globally unique or already registered.
12. Prepare the current supported inventory/listing file or guided Add Products workflow, as appropriate.
13. Validate required fields and marketplace template version before upload.
14. Obtain client approval before any upload that creates/updates offers or changes account data.
15. Submit using the authorized Seller Central workflow.
16. Review processing reports and row-level errors.
17. Verify the resulting seller offer/listing status in Seller Central.
18. Produce a mapping report and exceptions report.

Amazon-specific rules:
- An ASIN identifies a catalog product; a seller SKU identifies the seller's offer/inventory record. Keep them separate.
- A parent ASIN may not be the purchasable child product. Match the exact child variation where relevant.
- A matching ASIN does not prove the seller is allowed to sell the product.
- Existing catalog mapping is not new ASIN creation.
- Do not alter catalog attributes to force a match.
- Use current Amazon templates and current portal requirements; do not hardcode old flat-file columns or processing rules.

## 9. Flipkart mapping workflow

Official resource:
- Flipkart Seller Hub: https://seller.flipkart.com/

Workflow:
1. Confirm authorized access to the correct Flipkart seller account.
2. Collect the source product master and identify the target marketplace.
3. Normalize product records and preserve source data.
4. Check any supplied FSN using the current Seller Hub catalog/listing workflow.
5. For products without an FSN, search using exact identifiers and product attributes through supported Seller Hub tools.
6. Compare brand, model, product type, size, colour, pack count, and other material attributes.
7. Confirm the exact variant and vertical.
8. Check whether the seller can list the existing catalog item or whether brand/category approval is required.
9. Record FSN only when confirmed by an authoritative marketplace record.
10. Keep seller SKU/listing identifiers separate from FSN.
11. Prepare the current supported listing/inventory file or guided workflow.
12. Validate the current template and required attributes.
13. Obtain client approval before upload or activation.
14. Submit through the authorized Seller Hub workflow.
15. Review row-level processing results and errors.
16. Verify the resulting seller listing status in Seller Hub.
17. Produce a mapping report and exceptions report.

Flipkart-specific rules:
- FSN is a marketplace catalog identifier; do not invent it from a product title or another marketplace's ID.
- Do not assume that a product matching an Amazon ASIN has the same Flipkart FSN.
- A catalog match does not automatically grant brand approval, category eligibility, or listing activation.
- Follow the current Seller Hub category/vertical template and workflow.

## 10. Duplicate, variation, and bundle handling

Detect:
- Duplicate client SKUs.
- Multiple client SKUs pointing to one catalog item.
- One client SKU incorrectly pointing to multiple catalog items.
- Same product represented by multiple ASINs/FSNs.
- Parent/child variation confusion.
- Single unit versus multipack.
- Bundle versus standalone product.
- Different size/colour/model variants.
- Newer/older model revisions.
- Different condition or regional versions.

Rules:
- Multiple seller SKUs may legitimately map to one catalog item when the seller's internal SKU structure supports it; flag for client confirmation.
- One seller SKU should not map to multiple catalog IDs unless the client explicitly confirms a valid business rule and the marketplace workflow supports it.
- Do not collapse variants into one record.
- Do not map a multipack to a single unit or vice versa.
- Do not create variation relationships or change catalog variation themes under this skill.

## 11. Output files and reports

Create marketplace-specific outputs. Keep a master cross-marketplace mapping sheet, but never merge Amazon and Flipkart IDs into one ambiguous identifier column.

Recommended columns:

| Column | Meaning |
|---|---|
| Client SKU | Client's internal SKU |
| Marketplace | Amazon India / Flipkart |
| Marketplace Catalog ID | ASIN or FSN |
| Seller SKU | Seller's marketplace offer SKU |
| Product Title | Verified catalog title |
| Brand | Verified brand |
| Manufacturer | If available |
| Model / Part Number | Verified model |
| GTIN/EAN/UPC | Source identifier |
| Size / Colour | Material attributes |
| Pack Count | Unit or bundle quantity |
| Condition | New/used/etc., as supported |
| Match Tier | Matching method |
| Match Status | Controlled status |
| Eligibility Status | Allowed / approval required / blocked / unknown |
| Evidence Reference | Source file, URL, or portal evidence |
| Reviewer | Human reviewer |
| Notes | Discrepancies and decisions |

Recommended deliverables:
1. `master_mapping.xlsx` or CSV.
2. `amazon_mapping.xlsx` / CSV.
3. `flipkart_mapping.xlsx` / CSV.
4. `review_required.xlsx` / CSV.
5. `no_match_found.xlsx` / CSV.
6. `conflicts_and_duplicates.xlsx` / CSV.
7. `upload_ready` files in the current official marketplace template, only when requested and validated.
8. `mapping_summary.md` or PDF.

Do not fabricate a marketplace upload template. Obtain the current official template from the seller portal or use the current supported workflow. Record template download date/version where available.

## 12. Upload and activation controls

Mapping and uploading are separate stages.

Before upload:
- Verify seller account and marketplace.
- Verify current template version.
- Validate all mandatory fields.
- Ensure every row has an accepted match status.
- Ensure no unresolved material conflict exists.
- Check brand/category/condition eligibility.
- Check SKU uniqueness and duplicate rows.
- Obtain client approval for the exact upload file and intended action.

After upload:
- Save the upload/feed/job reference.
- Retrieve the processing report.
- Parse row-level success and error statuses.
- Do not mark all rows successful because the file upload was accepted.
- Verify successful records in the seller portal.
- Reconcile submitted row count, accepted row count, rejected row count, and pending row count.
- Correct errors only using validated client data and approved changes.
- Never repeatedly submit the same failed file without analyzing the processing report.

## 13. Error handling

Use these error categories:
- `SOURCE_FILE_UNREADABLE`
- `MISSING_PRODUCT_IDENTIFIER`
- `INVALID_IDENTIFIER`
- `DUPLICATE_CLIENT_SKU`
- `CATALOG_RECORD_NOT_FOUND`
- `AMBIGUOUS_CATALOG_MATCH`
- `PRODUCT_ATTRIBUTE_CONFLICT`
- `VARIATION_MISMATCH`
- `PACK_COUNT_MISMATCH`
- `BRAND_MISMATCH`
- `CONDITION_MISMATCH`
- `BRAND_APPROVAL_REQUIRED`
- `CATEGORY_APPROVAL_REQUIRED`
- `ACCOUNT_ELIGIBILITY_BLOCK`
- `TEMPLATE_VERSION_ERROR`
- `UPLOAD_VALIDATION_ERROR`
- `MARKETPLACE_PROCESSING_ERROR`
- `PORTAL_UNAVAILABLE`
- `UNKNOWN`

Recovery:
1. Preserve the original input and error response.
2. Identify the affected row/SKU and marketplace.
3. Separate confirmed error from suspected cause.
4. Request only the missing/correct source data.
5. Re-run matching and validation on the affected records.
6. Obtain approval for material mapping changes.
7. Re-upload only the corrected, validated rows when supported.
8. Verify the marketplace result before closing the issue.

Never auto-resolve an ambiguous match by choosing the first search result.

## 14. Security and data handling

- Process only client-authorized catalog data.
- Store client files in access-controlled, client-isolated storage.
- Do not commit client files, supplier invoices, credentials, cookies, or API tokens to GitHub.
- Use synthetic data in tests.
- Keep marketplace credentials and session tokens out of scripts, logs, and reports.
- Use official authorized seller sessions and supported APIs only.
- Do not bypass CAPTCHA, MFA, rate limits, or access controls.
- Mask sensitive contact, tax, and banking data in reports.
- Preserve original source files and create working copies.
- Record file hashes or version references where useful for audit.
- Apply agreed retention and secure deletion policies.

## 15. Automation and implementation guidance

The skill may use local scripts for deterministic tasks. Suggested implementation modules:

- `normalize_catalog.py`: normalize safe text/units while preserving source columns.
- `validate_identifiers.py`: validate GTIN/EAN/UPC/ISBN formats and check digits.
- `detect_duplicates.py`: identify duplicate SKUs and repeated identifiers.
- `compare_candidates.py`: compare product attributes and flag conflicts.
- `build_mapping_workbook.py`: generate master and marketplace-specific mapping files.
- `validate_upload_template.py`: validate against a current official template supplied by the user.
- `parse_processing_report.py`: parse marketplace row-level processing results.
- `generate_mapping_report.py`: produce summary and exception reports.

Implementation constraints:
- Scripts must be deterministic and independently testable.
- Do not embed credentials or use undocumented endpoints.
- Do not scrape or automate marketplace pages in ways that violate current marketplace terms or access controls.
- Browser actions must use an authorized session and stop at human verification.
- Do not claim API access or automatic catalog search unless a supported tool/API is actually configured.
- If no official catalog search integration is available, produce a manual research queue with exact search terms and fields to verify.
- Use `pandas`/`openpyxl` or equivalent approved local libraries for spreadsheets, while preserving identifiers as strings.
- Never parse long identifiers into floating-point values.

## 16. Quality assurance and test cases

Use synthetic products and mock marketplace responses. Never use live client credentials in tests.

Required tests:
1. Exact supplied ASIN with matching product attributes.
2. Exact supplied FSN with matching product attributes.
3. Valid GTIN with one exact catalog result.
4. Valid GTIN with multiple conflicting results.
5. Invalid GTIN check digit.
6. Leading-zero identifier preserved through Excel/CSV round trip.
7. Same title but different model number.
8. Same model but different pack count.
9. Parent ASIN versus child ASIN.
10. Different colour/size variant.
11. Bundle versus standalone item.
12. Same product with duplicate client SKUs.
13. One SKU with conflicting candidate catalog IDs.
14. No existing catalog match.
15. Existing catalog match but brand gated.
16. Existing catalog match but category restricted.
17. Existing catalog match but condition unsupported.
18. Outdated upload template.
19. Partial marketplace upload success.
20. Marketplace processing report with row-level rejection.
21. Timeout after upload; verify job status before retry.
22. Unauthorized upload attempt.
23. Client source data changed after approval.
24. Sensitive information leakage in logs/reports.

Acceptance criteria:
- No invented catalog identifiers.
- No automatic acceptance of ambiguous or conflicting matches.
- Amazon and Flipkart IDs stored separately.
- Source values preserved.
- Every accepted match has evidence and a recorded matching rationale.
- Eligibility blockers are not confused with catalog matching.
- Upload files conform to the current official template.
- Row-level upload results are reconciled.
- Client approval gates are enforced.
- Reports mask sensitive information.

## 17. Commercial interpretation of "Unlimited"

For SOLLUNA's plan comparison, describe this service as:

"Unlimited mapping of eligible existing catalog products, subject to marketplace availability, complete and accurate client data, agreed processing schedules, operational feasibility, and the plan's scope."

Operational rules:
- No fixed small monthly row cap is imposed by this skill.
- Batch work according to file size, quality, complexity, and agreed turnaround.
- Prioritize clean, identifier-complete products before research-heavy records.
- Maintain a queue for missing data, ambiguous matches, and marketplace blockers.
- Extensive product research, data enrichment, image creation, new catalog creation, and exceptional bulk cleanup are not automatically included.
- Flag unusually complex or exceptional bulk requirements for a SOLLUNA manager to scope.
- Do not invent or quote extra fees; escalate for a manager decision.

## 18. Execution response format

At the start of a mapping task, state:
- Client ID.
- Marketplace(s).
- Number of source product rows received.
- Available identifiers.
- Missing source fields.
- Whether client authorization is recorded.

At the end, report:
- Total source rows.
- Exact verified matches.
- High-confidence matches awaiting review.
- Review-required matches.
- No-match records.
- Conflicts and duplicates.
- Eligibility/approval blockers.
- Upload status, if upload was authorized.
- Marketplace processing successes, failures, and pending rows.
- Next client actions.
- Next SOLLUNA actions.

Never report a product as mapped merely because a candidate search result looks similar. A mapping is complete only when the product identity, marketplace catalog ID, evidence, and applicable review requirements are confirmed.
