---
name: amazon-new-listings
description: Create and publish new Amazon India product detail pages/listings for SOLLUNA clients when no suitable existing ASIN is available. Use for new product listing research, data collection, category and product-type selection, attribute completion, variation planning, image/content readiness, compliance checks, Seller Central submission, processing-error resolution, and launch verification. Do not use for mapping products to existing ASINs; use existing-catalog-mapping first.
---

# SOLLUNA — New Amazon Listings


### SOLLUNA platform pipeline (owner, 9 Nov 2026)
The client manager runs this as `NEW_LISTING` (`platform/apps/api/src/chat/pipelines.ts`); the plan's monthly new-listing limit applies when the form is submitted.
1. **Client:** fills the New listing form in Listings & Mapping (as much as they know). The step closes only when the server sees the form.
2. **Team, keywords:** keywordtool.io -> Google (plus the Amazon tab for Amazon) -> product name -> copy the top 100 keywords -> paste in the client's chat -> Pipelines. Duplicates are removed and the top 100 kept; for Amazon the system also builds search terms within Amazon's 250-byte limit.
3. **Team, create:** Seller Central -> Home -> Menu -> Catalog -> Add Products -> "I'm adding a product not sold on Amazon" -> product type. Missing details are completed from research; keywords go into Search terms (within 250 bytes); the other keywords go into title / bullets where they read naturally.
4. **Team:** marketplace check result (active in Manage inventory / errors) -> LIVE / ISSUE, from the marketplace's own status.
5. **Client:** manager shares the result.

## 1. Role and objective

Act as SOLLUNA's senior Amazon India catalog creation and listing specialist.

Create accurate, compliant, complete new Amazon.in product detail pages for client products only when:
- The product is genuinely not represented by a suitable existing ASIN; and
- The client is authorized to create the product detail page; and
- The current Amazon workflow permits the listing.

This skill covers new Amazon product detail page creation and the seller's offer setup where required. It does not guarantee listing acceptance, search ranking, buy-box placement, or sales.

## 2. Mandatory distinction: existing ASIN vs new ASIN

Before creating anything:
1. Run the Existing Catalog Mapping workflow or verify its completed result.
2. Search Amazon.in using available GTIN/EAN/UPC, brand, model/part number, exact title, and material product attributes.
3. Inspect plausible results for exact product identity, pack count, size, colour, model, and variant.
4. If a suitable existing ASIN exists, stop new-page creation and route to `existing-catalog-mapping`.
5. If a candidate exists but is ambiguous, send it to human review.
6. Create a new page only when there is sufficient evidence that no suitable ASIN exists and Amazon's current workflow permits it.

Never create duplicate ASINs to avoid restrictions, improve content, obtain another variation, or work around a rejected offer.

## 3. Operating principles

- Use current Amazon Seller Central workflows, category templates, and official help.
- Use accurate information supported by client/brand/manufacturer evidence.
- Never invent GTINs, model numbers, brand names, technical specifications, certifications, ingredients, dimensions, country of origin, or compliance claims.
- Never use another brand's ASIN or content for a different product.
- Never copy competitor text or images.
- Never create fake reviews, ratings, sales claims, badges, or endorsements.
- Never make unsupported medical, health, safety, environmental, performance, or comparative claims.
- Preserve client source data and original product images.
- Keep product facts separate from marketing copy.
- Do not submit a listing or make a consequential catalog change without client approval.
- Treat category, brand, product-type, GTIN exemption, and compliance approvals as separate eligibility checks.
- Do not assume a GTIN exemption is available or approved.
- Do not assume a listing is live because a feed/file was accepted.
- Record submission evidence and verify the resulting ASIN and listing status.

## 4. Scope

### Included
- New ASIN eligibility assessment.
- Product data intake and normalization.
- Existing ASIN search and duplicate prevention.
- Category/product-type selection.
- Required attribute checklist.
- GTIN/EAN/UPC validation and exemption-route identification.
- Brand and selling-eligibility checks.
- Product title, bullets, description, and backend search-term preparation.
- Image readiness and image requirement checks.
- Variation-family planning where permitted.
- Compliance/document readiness screening.
- Seller Central listing creation or current supported flat-file workflow.
- Processing report analysis and correction.
- ASIN capture and listing-status verification.
- Client-facing listing handover report.

### Excluded
- Existing ASIN mapping (use the dedicated skill).
- Brand approval/brand gating applications (use Brand Approval Assistance).
- Trademark registration or legal advice.
- Product testing, certification, lab reports, or regulatory approval.
- Creating or editing product images beyond agreed creative scope.
- A+ Content, Storefront, advertising, promotions, or ongoing SEO management unless separately included.
- Inventory purchasing, fulfilment operations, and order management.
- Guaranteeing Amazon approval, ranking, traffic, or sales.

## 5. Client and product intake

Collect the following before listing work.

### 5.1 Client and account
- SOLLUNA client ID.
- Seller legal/business name.
- Amazon marketplace: Amazon.in.
- Seller account reference, if available.
- Authorized contact and role.
- Confirmation that SOLLUNA may prepare and, if separately authorized, submit listing information.
- Contracted plan and monthly listing allowance.
- Number of listings already consumed in the current billing month.

### 5.2 Product identity
- Client SKU.
- Exact brand name and spelling.
- Product name/type.
- Manufacturer legal name.
- Manufacturer part number/model number.
- GTIN/EAN/UPC/ISBN, if applicable.
- Pack count and unit quantity.
- Product condition.
- Product category/use.
- Size, colour, material, capacity, dimensions, weight, flavour, scent, compatibility, or other relevant attributes.
- Country of origin.
- Manufacturer/importer/packer details as applicable.
- Intended target customer/use, only where factual and relevant.
- Product variations and their exact differences.

### 5.3 Supporting evidence
Request relevant originals or authoritative information:
- Product packaging photographs (all relevant sides).
- Product photographs.
- Manufacturer product specification sheet/catalogue.
- GTIN certificate or GS1 evidence, if available and relevant.
- Purchase invoice/supply-chain records where relevant.
- Brand authorization, if the client is not the brand owner and the marketplace requires it.
- Trademark evidence if needed for a brand workflow.
- Compliance certificates, test reports, declarations, or licenses where required for the product/category.
- MRP and package declarations, where applicable.
- Product dimensions and shipping weight.
- Warranty information and service details, if applicable.

Do not request irrelevant documents. Generate a category- and product-specific checklist after classifying the product.

## 6. Product eligibility and compliance gate

Before writing content, identify:
- Product category and product type.
- Whether the product is restricted, dangerous, regulated, or requires approval.
- Whether brand approval is required.
- Whether the product needs compliance documents or category-specific attributes.
- Whether the product can be sold on Amazon.in.
- Whether the client has the right to use the brand and product content.
- Whether the product is subject to special packaging, labelling, safety, or import requirements.

Potentially regulated areas include food, cosmetics, health products, electrical goods, toys, batteries, chemicals, medical devices, wireless/electronic equipment, and products with safety or environmental claims. This list is illustrative, not exhaustive.

Rules:
- Use current official Amazon policy and applicable Indian regulatory requirements.
- Do not infer legal compliance from a product title or supplier statement.
- Do not create a listing that makes an unsupported compliance claim.
- If a product needs a license, certificate, test report, or qualified review that is missing, block submission and request it.
- Refer legal/tax/regulatory questions to a qualified professional.
- Record the source and date checked for material compliance requirements.

## 7. Existing ASIN and duplicate prevention

Use the Existing Catalog Mapping skill or perform a documented pre-check.

Search:
1. Exact GTIN/EAN/UPC.
2. Exact brand + model/part number.
3. Exact product name.
4. Product name plus size/colour/pack count.
5. Manufacturer catalogue references.

Compare:
- Brand.
- Manufacturer.
- Model.
- Product type.
- Pack count.
- Size/capacity.
- Colour/material.
- Included accessories.
- Intended use and technical attributes.
- Product images/packaging.

Decision:
- Exact existing product: map to existing ASIN; do not create new.
- Plausible but uncertain result: human review.
- No suitable result with adequate search evidence: proceed to eligibility and new-page preparation.
- Existing ASIN with incorrect catalog data: use the relevant catalog correction process; do not create a duplicate page.

Record search terms, date, source, candidates reviewed, and final rationale.

## 8. GTIN and product identifier logic

Determine the identifier route from the current Amazon workflow.

- Validate supplied GTIN/EAN/UPC/ISBN format and check digit where applicable.
- Preserve identifiers as strings, including leading zeros.
- Check that the identifier belongs to the exact product/brand and correct pack configuration.
- Do not reuse a barcode for a different product or variation.
- Do not generate a random or fabricated GTIN.
- If no product identifier exists, investigate whether the product/category/brand qualifies for Amazon's current GTIN exemption route.
- GTIN exemption is subject to Amazon's current eligibility and approval rules.
- Do not claim an exemption is granted until the portal confirms it.
- If an identifier conflict exists, stop and request authoritative evidence.

## 9. Category and product-type selection

Select category/product type based on the actual product, not the category with the easiest listing requirements.

Workflow:
1. Identify the product's primary function and physical type.
2. Search Amazon's current category/product-type options.
3. Compare the product with the category definitions and required attributes.
4. Check restrictions and approval requirements.
5. Record the selected category and rationale.
6. If two categories appear plausible, escalate for human review.
7. Never misclassify a product to bypass a restriction or reduce compliance obligations.

Use the current category-specific template or Seller Central product-type schema. Do not hardcode old flat-file column sets.

## 10. Listing content preparation

Prepare content in a factual, customer-useful, policy-compliant manner.

### 10.1 Product title
Include only relevant and supported details, such as:
- Brand.
- Product type.
- Model/name.
- Key differentiating attribute.
- Size/capacity/quantity/pack count.
- Variant, where applicable.

Rules:
- Follow the current Amazon title policy and category-specific character/format limits.
- Avoid keyword stuffing, repetition, promotional claims, seller contact information, URLs, price, discounts, shipping claims, and unsupported superlatives.
- Do not put irrelevant keywords into the title.
- Do not invent compatibility or performance statements.

### 10.2 Bullet points
Prepare concise bullets covering relevant verified facts:
- Main product function.
- Material/construction.
- Size/dimensions/capacity.
- Included items and pack quantity.
- Compatibility or usage instructions, where verified.
- Care, safety, warranty, or limitations, where supported.

Do not convert uncertain statements into facts. Avoid unsupported "best", "100% safe", "guaranteed", medical, therapeutic, or certification claims.

### 10.3 Product description
- Explain the product accurately.
- Describe intended use and relevant features.
- Include important limitations and package contents.
- Use clear, readable language.
- Do not include seller contact details, external links, review requests, promotional offers, or prohibited claims.
- Follow current Amazon content policies and category restrictions.

### 10.4 Backend search terms
- Use relevant synonyms and customer search language.
- Avoid repeating title terms unnecessarily where policy advises against it.
- Do not include competitor brands, misleading terms, unrelated keywords, prohibited claims, or another seller's identifiers.
- Follow current byte/character limits and field rules.
- Do not promise search ranking or traffic.

### 10.5 Language
Use the language supported by the current Amazon.in listing workflow and client requirements. Ensure spelling, units, and terminology are consistent. If translating, preserve product facts and have a human review technical/regulatory wording.

## 11. Images and media readiness

Collect or prepare images according to current Amazon image policy and the product category.

Review:
- Main image shows the exact product being sold.
- Product is clearly visible and accurately represented.
- Background, crop, resolution, dimensions, and file type meet current category requirements.
- No misleading props or accessories that are not included.
- No watermarks, promotional badges, review stars, contact details, or prohibited text on the main image.
- Secondary images accurately show features, dimensions, packaging, usage, and included contents.
- Infographics do not make unsupported claims.
- Packaging images match the actual product/variant.
- Image content does not imply certifications or approvals the product does not have.

Do not digitally add a brand logo, certification, label, or product feature that is not physically/legally present. If image creation/editing is required, route to the relevant creative service and require client approval.

## 12. Variation and parent-child planning

Use variations only when the products are genuinely related and Amazon's current category rules permit the variation theme.

Potential variation themes may include size, colour, flavour, style, or other category-supported attributes. Do not assume every category supports every theme.

Rules:
- Parent is a non-buyable grouping record where the current workflow defines it as such.
- Child records must represent real purchasable variants.
- Every child must have accurate identifiers and attributes.
- Do not group unrelated products, different models, different product functions, or standalone bundles merely to combine reviews or traffic.
- Do not create artificial variations.
- Do not change a product's identity to fit an existing variation family.
- Validate parent-child relationships using the current category template and Amazon policy.
- Obtain client approval for the proposed variation structure.

If variation eligibility is uncertain, create separate review records and escalate rather than submitting an invalid family.

## 13. Attribute and listing data validation

Build a category-specific attribute checklist from the current product-type requirements.

Possible fields:
- Product type/category.
- Brand.
- Manufacturer.
- Model/part number.
- External product ID and type.
- Item name/title.
- Product description.
- Bullet points.
- Search terms.
- Package quantity.
- Item dimensions and unit.
- Package dimensions and unit.
- Item weight and unit.
- Colour/size/material.
- Included components.
- Country of origin.
- Manufacturer/importer/packer details.
- MRP and other package details where applicable.
- Compliance/certification fields where required.
- Warranty/service fields where applicable.
- Variation theme and child attributes where applicable.

Validation rules:
- Mandatory attributes must be populated from reliable data.
- Units must be explicit and internally consistent.
- Do not mix product dimensions with package dimensions.
- Do not confuse net quantity, pack count, and shipping weight.
- Check that title, bullets, images, identifiers, and attributes describe the same product.
- Check variation values are unique and accurate.
- Flag any value that is inferred rather than sourced.
- Do not use placeholder text in production submissions.

## 14. Seller Central creation and submission workflow

Official resources:
- Seller Central: https://sellercentral.amazon.in/
- Amazon India listing guidance: https://sell.amazon.in/sell-online/list-your-products
- Amazon Seller Central help: https://sellercentral.amazon.in/help/hub

Workflow:
1. Confirm authorized access to the correct seller account.
2. Confirm the contracted plan and remaining monthly listing allowance.
3. Complete the existing-ASIN search and save the result.
4. Complete brand, category, GTIN, and compliance eligibility checks.
5. Build the product data sheet using the current category/product-type requirements.
6. Prepare title, bullets, description, search terms, images, identifiers, and attributes.
7. Validate all data and source evidence.
8. Generate a client review preview showing the exact content, images, category, identifiers, variations, and intended action.
9. Obtain explicit client approval.
10. Use the current Seller Central Add Products workflow or current official flat-file/template process.
11. Have the authorized seller user complete credentials, OTP, CAPTCHA, and personal declarations.
12. Submit only the approved data.
13. Capture submission/feed/job reference and timestamp.
14. Retrieve processing results and parse row-level errors.
15. Correct only validated errors with client approval where the change is material.
16. Verify the ASIN and resulting listing status in Seller Central.
17. Confirm whether the listing is active, incomplete, suppressed, blocked, or pending.
18. Produce the handover report.

Do not assume the user interface, template names, columns, or processing steps are permanent. Use the current workflow shown in the seller account.

## 15. Listing status model

Track these separately:

- `research_not_started`
- `existing_asin_check`
- `existing_asin_found`
- `new_asin_candidate`
- `eligibility_check`
- `documents_pending`
- `content_in_progress`
- `content_review`
- `client_approval_pending`
- `approved_for_submission`
- `submitted`
- `processing`
- `processing_error`
- `asin_created`
- `listing_incomplete`
- `suppressed`
- `approval_required`
- `active`
- `blocked`
- `cancelled`

Do not transition to `active` merely because:
- A file uploaded successfully.
- A feed was accepted.
- An ASIN was generated.
- The product appears in a draft.
- Seller Central returned a generic success message.

Require current Seller Central evidence that the seller's offer is active and buyable/available as applicable. Record any remaining inventory, pricing, fulfilment, or compliance prerequisites separately.

## 16. Error handling

Use these categories:
- `EXISTING_ASIN_FOUND`
- `DUPLICATE_ASIN_RISK`
- `GTIN_INVALID`
- `GTIN_CONFLICT`
- `GTIN_EXEMPTION_REQUIRED`
- `BRAND_APPROVAL_REQUIRED`
- `CATEGORY_APPROVAL_REQUIRED`
- `PRODUCT_RESTRICTED`
- `COMPLIANCE_DOCUMENT_MISSING`
- `PRODUCT_TYPE_MISMATCH`
- `MISSING_REQUIRED_ATTRIBUTE`
- `INVALID_ATTRIBUTE_VALUE`
- `VARIATION_ERROR`
- `IMAGE_POLICY_ERROR`
- `CONTENT_POLICY_ERROR`
- `FEED_PROCESSING_ERROR`
- `ASIN_CREATION_REJECTED`
- `LISTING_SUPPRESSED`
- `OFFER_NOT_ACTIVE`
- `PORTAL_UNAVAILABLE`
- `UNKNOWN`

Recovery:
1. Save the exact error message and affected SKU/row.
2. Determine whether the error is catalog-level, offer-level, account-level, category-level, brand-level, or compliance-related.
3. Identify the confirmed cause; distinguish it from a hypothesis.
4. Consult the current official error/help reference.
5. Request missing facts/documents from the client.
6. Correct only the affected data.
7. Revalidate the complete record.
8. Obtain approval for material changes.
9. Resubmit only when safe and appropriate.
10. Verify the result in Seller Central.

Do not repeatedly upload unchanged files. For uncertain submission outcomes, check the processing report and Seller Central before retrying.

## 17. Security and authorization

- Use only client-authorized seller accounts and data.
- Never ask for or store seller passwords, OTPs, recovery codes, or session tokens.
- The account owner enters credentials, OTP, CAPTCHA, and personal declarations directly.
- Use official Amazon domains and supported workflows.
- Do not bypass MFA, CAPTCHA, bot controls, rate limits, or access restrictions.
- Store client product data and documents in access-controlled client folders.
- Do not commit live client data, documents, credentials, cookies, or tokens to GitHub.
- Mask sensitive business/tax/contact information in logs and reports.
- Preserve original source files and work on copies.
- Use synthetic data for tests.
- Record client approval and submission evidence.
- Pause if the client asks for misleading content, fake identifiers, false compliance claims, or duplicate catalog creation.

## 18. Commercial plan and listing allowance

The SOLLUNA plan defines the monthly allowance:
- Reseller: 3 new Amazon listings per billing month.
- Growth: 25 new Amazon listings per billing month.
- Premium: unlimited, subject to operational feasibility, marketplace rules, agreed processing schedules, and exceptional-work boundaries.

Counting rules:
- Count a listing against the client's plan when a new product detail page/listing creation task is accepted for production, according to SOLLUNA's agreed billing policy.
- Do not count existing-ASIN mapping as a new listing.
- Do not count the same listing repeatedly because of ordinary error correction or resubmission unless the commercial agreement explicitly says otherwise.
- Track each client SKU/product and each new ASIN creation request.
- Variations must be counted according to the actual child product pages/listings and SOLLUNA's approved counting policy. Do not silently treat a multi-child variation family as one listing.
- Record cancellations and failed attempts transparently.
- Never promise unlimited creative production, regulatory research, or exceptional catalog repair as part of unlimited listing count.
- If plan allowance is exhausted, pause new listing work and request a SOLLUNA manager decision. Do not invent charges.

## 19. Output files and handover

Create:
1. Product intake sheet.
2. Existing-ASIN search and duplicate-check report.
3. Category/product-type and compliance checklist.
4. Product data sheet.
5. Content preview (title, bullets, description, search terms).
6. Image readiness checklist.
7. Variation plan, if applicable.
8. Client approval record.
9. Submission/processing report.
10. Final listing handover report.

Final report fields:
- Client ID.
- Amazon seller account reference (masked as appropriate).
- Client SKU.
- Product/brand/model.
- Selected category/product type.
- Existing-ASIN search outcome.
- New ASIN, only if confirmed.
- Submission date/reference.
- Processing result.
- Listing status.
- Suppression/approval/compliance blockers.
- Inventory/offer prerequisites not handled by this skill.
- Evidence references.
- Pending actions.
- Last verification timestamp.

Final outcomes:
- `ACTIVE_AND_VERIFIED`
- `ASIN_CREATED_LISTING_NOT_ACTIVE`
- `SUBMITTED_AWAITING_PROCESSING`
- `CLIENT_ACTION_REQUIRED`
- `APPROVAL_OR_COMPLIANCE_BLOCKED`
- `EXISTING_ASIN_MAPPING_REQUIRED`
- `NO_MATCH_RESEARCH_INCOMPLETE`
- `REJECTED_REQUIRES_CORRECTION`
- `CANCELLED`

## 20. Quality assurance and test cases

Use synthetic products and mock marketplace responses. Do not use live credentials or submit test products to production.

Required tests:
1. Exact existing ASIN found — new listing creation blocked and routed to mapping.
2. No existing ASIN found with complete evidence.
3. Ambiguous ASIN search results — human review required.
4. Invalid GTIN check digit.
5. Leading-zero GTIN preserved in spreadsheet.
6. GTIN belongs to a different pack count.
7. Brand approval required.
8. Category approval required.
9. Restricted product — submission blocked.
10. Missing compliance certificate — submission blocked.
11. Product title contains unsupported claim.
12. Main image violates current image requirements.
13. Product dimensions and package dimensions confused.
14. Variation family contains unrelated products.
15. Child variant missing required identifier.
16. Current template has changed.
17. Partial feed processing success.
18. ASIN created but offer inactive.
19. Listing suppressed after creation.
20. Submission timeout — status checked before retry.
21. Client approval absent — submission blocked.
22. Monthly listing allowance exceeded.
23. Client requests duplicate ASIN creation.
24. Sensitive data leakage in logs/reports.

Acceptance criteria:
- Existing ASIN check precedes new page creation.
- No fabricated identifiers or attributes.
- Category and compliance checks completed.
- Product content is evidence-backed and policy-reviewed.
- Client preview and approval recorded.
- Current official template/workflow used.
- Processing report reconciled row by row.
- ASIN and active offer status independently verified.
- Monthly plan allowance tracked correctly.
- Final report accurately reflects outstanding blockers.

## 21. Source-of-truth rules

Amazon policies, category requirements, title limits, image requirements, product-type attributes, and templates can change.

Before a definitive recommendation or submission:
1. Check current Amazon Seller Central help and the live listing workflow.
2. Prefer official Amazon India material over third-party articles.
3. Record source URL and date checked for material requirements.
4. Use the current product-type/category template supplied by Seller Central.
5. Do not hardcode historical title character limits, image dimensions, flat-file columns, invoice requirements, or compliance lists.
6. If official information is unavailable or conflicting, mark it `UNCONFIRMED` and escalate.

## 22. Execution response format

At task start, report:
- Client ID.
- Amazon seller account reference.
- Product count received.
- Current billing-month listing allowance and used count.
- Existing-ASIN check status.
- Missing product facts/documents.
- Eligibility/compliance blockers.
- Authorization status.

At task end, report:
- New listing candidates.
- Existing ASIN matches routed to mapping.
- Listings prepared for review.
- Client approvals obtained/pending.
- Submissions and processing outcomes.
- Confirmed ASINs.
- Active, incomplete, suppressed, or blocked offers.
- Monthly allowance remaining.
- Client actions and SOLLUNA next actions.

A new listing is complete only when the product detail page and seller offer have been verified at the appropriate status in Seller Central. An ASIN alone is not proof that the product is actively available for sale.
