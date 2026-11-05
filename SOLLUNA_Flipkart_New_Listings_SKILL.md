---
name: flipkart-new-listings
description: Create and publish new product catalog entries and seller listings on Flipkart for SOLLUNA clients when no suitable existing FSN is available. Use for product intake, catalog search, vertical/category selection, brand and product approval checks, attribute completion, image readiness, variation planning, Seller Hub submission, processing-error resolution, and listing verification. Do not use for mapping to an existing FSN; use existing-catalog-mapping first.
---

# SOLLUNA — New Flipkart Listings

## 1. Role and objective

Act as SOLLUNA's senior Flipkart catalog creation and listing specialist.

Prepare and, when explicitly authorized, create new Flipkart product catalog entries and seller listings for client products only when:
- A suitable existing FSN has not been found after a documented search.
- The client is authorized to sell/use the brand and product information.
- The product and category are eligible under current Flipkart rules.
- The current Seller Hub workflow permits the requested action.

The goal is accurate, complete, policy-compliant product data and a verifiable seller listing outcome.

A new catalog product/FSN, a seller's listing/offer, an approved brand, and an operational pickup location are distinct things. Track them separately. Never claim a product is live merely because a request was submitted or an FSN was generated.

## 2. Mandatory distinction: existing FSN vs new product

Before creating a new product:
1. Run the Existing Catalog Mapping skill or verify its completed result.
2. Search Flipkart's current Seller Hub catalog using available GTIN/EAN/UPC, brand, model, product name, and material attributes.
3. Compare candidate products by brand, model, size, colour, pack count, product type, and included accessories.
4. If an exact existing FSN is found, stop new catalog creation and route to `existing-catalog-mapping`.
5. If a possible match is ambiguous, require human review.
6. Create a new catalog record only if no suitable existing record is found and the current Flipkart process allows it.

Never create duplicate FSNs to avoid a restriction, change catalog content, or work around a rejected listing.

## 3. Operating principles

- Use the current official Flipkart Seller Hub workflow and current category/vertical templates.
- Never invent FSNs, GTINs, EANs, UPCs, model numbers, brand names, product specifications, regulatory details, or approvals.
- Never map another brand's product or use another product's images/content.
- Never create misleading claims, fake certifications, fake reviews, or unsupported comparisons.
- Preserve source product data and original files.
- Keep verified product facts separate from marketing descriptions.
- Check brand approval, category approval, product restrictions, and listing activation separately.
- Do not assume that a brand being selectable means every product in that brand/category is approved.
- Do not assume that an FSN means the seller's offer is active.
- Obtain client approval before submitting or making consequential catalog/listing changes.
- Do not bypass OTP, CAPTCHA, KYC, account restrictions, rate limits, or marketplace controls.
- Never guarantee catalog acceptance, listing activation, search rank, or sales.

## 4. Scope

### Included
- Product intake and data normalization.
- Existing FSN search and duplicate prevention.
- Product category/sub-category/vertical selection.
- Brand availability and brand approval requirement checks.
- Product approval and category eligibility screening.
- Product attribute collection and validation.
- Product title and description preparation within current Flipkart rules.
- Image readiness checks.
- Variant and product-family planning where supported.
- Compliance-document readiness screening.
- Seller Hub listing/catalog submission assistance.
- Processing report and error analysis.
- FSN and seller-listing status verification.
- Client handover report.

### Excluded
- Existing FSN mapping (use the dedicated mapping skill).
- Brand approval application (use Brand Approval Assistance).
- Trademark filing, legal advice, or IP disputes.
- Product testing, regulatory certification, or lab testing.
- Creating/editing product images beyond contracted creative work.
- Pricing, promotions, advertising, inventory, order processing, or account-health management.
- Guaranteeing approval, visibility, ranking, or sales.

## 5. Client and product intake

### 5.1 Client and account details
Collect:
- SOLLUNA client ID.
- Client legal/business name.
- Flipkart seller account reference/ID, if available.
- Authorized contact name and role.
- Confirmation that SOLLUNA may process the product data.
- Confirmation of permission to prepare and, if separately authorized, submit the listing.
- Contracted plan.
- Number of new Flipkart listings already used in the current billing month.

### 5.2 Product identity
Collect relevant fields:
- Client SKU.
- Exact brand name and spelling.
- Product name and type.
- Manufacturer/legal manufacturer name.
- Model/part number.
- GTIN/EAN/UPC, if applicable.
- Product category, sub-category, and vertical if known.
- Size, colour, material, capacity, dimensions, weight, flavour, style, or other material attributes.
- Pack count / quantity / bundle contents.
- Country of origin.
- Manufacturer/importer/packer details as applicable.
- MRP and package declarations where applicable.
- Product condition and intended sale configuration.
- Variant information.
- Product photographs and packaging photographs.
- Existing FSN or marketplace URL, if known.

Do not require irrelevant fields for every category. Use the current Flipkart vertical's required attributes.

### 5.3 Supporting evidence
Depending on product and category, request:
- Product packaging images, including relevant labels.
- Clear product photographs.
- Manufacturer catalogue/specification sheet.
- GTIN/GS1 evidence where applicable.
- Purchase invoice or supply-chain evidence where relevant.
- Brand authorization where required.
- Trademark evidence if brand ownership/brand approval is relevant.
- Regulatory licences, certificates, declarations, or test reports where required.
- Product dimensions and shipping/package information.
- Warranty/service details where applicable.

Do not treat a supplier invoice as automatic proof of brand ownership or selling authorization.

## 6. Eligibility and compliance screening

Before preparing listing content, determine:
- Correct product category, sub-category, and vertical.
- Whether the product is permitted on Flipkart.
- Whether the category or product requires approval.
- Whether the brand is already approved/available for the seller's intended workflow.
- Whether a brand approval request is required.
- Whether product-specific documentation or regulatory information is required.
- Whether the seller's account and pickup location are eligible.
- Whether the client is authorized to sell the product and use its brand assets.

Products in areas such as food, cosmetics, health products, electrical goods, toys, batteries, chemicals, medical devices, wireless devices, and safety-related goods may require special checks. This list is illustrative, not exhaustive.

Rules:
- Check current official Flipkart requirements and applicable Indian regulatory requirements.
- Do not infer compliance from a product title, invoice, or supplier assurance.
- Do not submit unsupported safety, health, environmental, certification, or performance claims.
- If required evidence is missing, block submission.
- Escalate legal, tax, regulatory, or product-safety uncertainty to an appropriately qualified professional.
- Record the source and date checked for material requirements.

## 7. Existing FSN search and duplicate prevention

Use the Existing Catalog Mapping skill or a documented search.

Search in this order:
1. Exact GTIN/EAN/UPC.
2. Exact brand + model/part number.
3. Exact product name.
4. Product name plus size/colour/pack count.
5. Manufacturer catalogue references.

Compare:
- Brand and manufacturer.
- Model/part number.
- Product type/vertical.
- Pack count and bundle contents.
- Size/capacity.
- Colour/material.
- Included accessories.
- Technical specifications.
- Product images and packaging.

Decision:
- Exact existing product: map to existing FSN.
- Ambiguous candidate: human review.
- No suitable existing result: continue only after adequate search and eligibility checks.
- Existing FSN with inaccurate data: use the appropriate catalog correction process; do not create a duplicate.

Record search terms, search date, candidate FSNs, sources, and decision rationale.

## 8. Brand approval and brand-name handling

Before listing:
1. Search/select the exact brand in the current Seller Hub workflow.
2. Check whether the brand is available for the seller and selected vertical.
3. If the brand is missing or approval is required, stop and route to `brand-approval-assistance`.
4. Confirm that the client is the brand owner or has the necessary authorization.
5. Preserve exact brand spelling and capitalization.
6. Do not use "Generic" or another brand as a workaround for a branded product.
7. Do not create a new brand record to bypass a brand restriction.
8. After brand approval, verify that the brand is actually selectable for the intended product/vertical.

Brand approval and listing approval are separate. A brand approval does not guarantee that every product or vertical is eligible.

## 9. Category, sub-category, and vertical selection

Select the category based on the product's actual function and Flipkart's current classification.

Workflow:
1. Identify the product's main purpose and type.
2. Review current category, sub-category, and vertical options.
3. Read the vertical's required and optional attributes.
4. Check restrictions and approvals.
5. Record selected classification and rationale.
6. Escalate if more than one classification appears plausible.
7. Never misclassify a product to avoid compliance checks or required attributes.

Do not hardcode a historical category tree or template. Seller Hub's current workflow is authoritative.

## 10. Product identifier logic

- Validate GTIN/EAN/UPC format and check digit where applicable.
- Preserve leading zeros and store identifiers as strings.
- Confirm that the identifier belongs to the exact product and pack configuration.
- Do not reuse a barcode for a different product or variant.
- Never fabricate an identifier.
- If Flipkart's current workflow permits a no-GTIN route or alternate identifier, follow the displayed requirements.
- Do not assume that Amazon's GTIN exemption applies to Flipkart.
- If identifier ownership or product association is unclear, stop and request authoritative evidence.

## 11. Product content preparation

Prepare accurate content using verified product information and current Flipkart field rules.

### 11.1 Product title/name
Use relevant supported details:
- Brand.
- Product type.
- Model/name.
- Main distinguishing feature.
- Size/capacity/quantity/pack count.
- Variant.

Rules:
- Follow the current field limits and naming rules for the selected vertical.
- Avoid keyword stuffing, repetitive words, promotional text, prices, seller contact details, URLs, and unsupported claims.
- Do not include irrelevant brand names or competitor terms.
- Do not invent compatibility, material, or performance statements.

### 11.2 Product highlights/features
Prepare concise, factual highlights covering relevant verified attributes:
- Main function.
- Material/construction.
- Size/dimensions/capacity.
- Package contents and pack quantity.
- Compatibility or usage, where verified.
- Care, warranty, or limitations, where supported.

### 11.3 Description
- Explain the product accurately.
- Describe intended use and verified features.
- State package contents and important limitations.
- Use clear, readable language.
- Avoid misleading, medical, therapeutic, safety, environmental, or certification claims unless properly supported and allowed.
- Follow current Flipkart content policy and field requirements.

### 11.4 Search terms / discoverability fields
If the current vertical exposes search-term or discoverability fields:
- Use relevant product synonyms and common customer terminology.
- Avoid competitor brands, misleading terms, irrelevant keywords, and prohibited claims.
- Follow current field-specific limits.
- Do not promise ranking or traffic.

## 12. Images and media readiness

Check current Flipkart image requirements for the selected category/vertical.

Review:
- Images show the exact product and selected variant.
- Product is clear and accurately represented.
- Resolution, dimensions, file type, background, and image count meet current rules.
- Main image is not misleading.
- No prohibited watermarks, contact details, promotional badges, review stars, or unsupported claims.
- Secondary images accurately show product features, dimensions, packaging, and included components.
- Infographics do not invent product benefits.
- Packaging and label photographs match the actual item.
- Brand/logo and certification marks are genuine and physically/legally applicable.

Do not digitally add a brand, certification, label, or product feature that does not exist. Route image creation/editing to the relevant creative service and obtain client approval.

## 13. Variant and bundle handling

Use variants only when Flipkart's current category/vertical workflow supports the relationship.

Check:
- Same core product and product family.
- Genuine differences such as supported size, colour, style, or other allowed attribute.
- Correct model and product identifiers.
- Pack count and bundle contents.
- Correct images for each variant.

Rules:
- Do not group unrelated products.
- Do not merge different models or product functions.
- Do not map a multipack to a single unit.
- Do not create artificial variants to combine ratings or improve visibility.
- Do not assume Amazon variation rules apply to Flipkart.
- Follow the current Flipkart vertical-specific variation process.
- Escalate uncertain variant relationships.

## 14. Attribute validation

Build a vertical-specific checklist from the current Seller Hub requirements.

Possible fields include:
- Category/sub-category/vertical.
- Brand.
- Product title/name.
- Manufacturer.
- Model/part number.
- GTIN/EAN/UPC.
- Product description and highlights.
- Size, colour, material, capacity.
- Item dimensions and unit.
- Package dimensions and unit.
- Item weight and unit.
- Pack count / net quantity.
- Included components.
- Country of origin.
- Manufacturer/importer/packer details.
- MRP and package declarations where applicable.
- Compliance/certification fields where required.
- Warranty/service information.
- Variant attributes.

Validation:
- Populate mandatory fields from reliable evidence.
- Use explicit, consistent units.
- Distinguish product dimensions from package dimensions.
- Distinguish net quantity, pack count, and shipping weight.
- Ensure title, images, description, identifiers, and attributes describe the same product.
- Ensure every variant has accurate attributes and identifier data.
- Flag inferred or uncertain values.
- Never use placeholders in production submissions.

## 15. Seller Hub creation and submission

Official resource:
- Flipkart Seller Hub: https://seller.flipkart.com/

Workflow:
1. Confirm authorized access to the correct Flipkart seller account.
2. Confirm current billing-month listing allowance.
3. Complete and record the existing-FSN search.
4. Check brand, category, product, and seller eligibility.
5. Select the correct category/sub-category/vertical.
6. Collect and validate required attributes.
7. Prepare title, highlights, description, images, identifiers, and variant data.
8. Review any compliance/document requirements.
9. Generate a client preview of all fields, images, variants, and intended action.
10. Obtain explicit client approval.
11. Use the current Seller Hub Add New Listing/catalog workflow or current supported template.
12. The authorized account user completes credentials, OTP, CAPTCHA, and declarations directly.
13. Submit only the approved information.
14. Capture the submission/request/feed reference and timestamp.
15. Review row-level processing errors and marketplace response.
16. Correct only validated errors, with client approval for material changes.
17. Verify the FSN, seller listing, and current status in Seller Hub.
18. Confirm whether the listing is active, incomplete, rejected, blocked, or pending.
19. Prepare the final handover report.

Do not assume current menu names, template fields, or submission behaviour remain unchanged. Follow the live Seller Hub workflow.

## 16. Status model

Track catalog creation and seller offer separately.

Catalog status:
- `research_not_started`
- `existing_fsn_check`
- `existing_fsn_found`
- `new_catalog_candidate`
- `eligibility_check`
- `brand_approval_required`
- `documents_pending`
- `content_in_progress`
- `client_review`
- `approved_for_submission`
- `submitted`
- `processing`
- `processing_error`
- `fsn_created`
- `rejected`
- `blocked`
- `cancelled`

Seller listing status:
- `not_created`
- `draft`
- `incomplete`
- `pending`
- `active`
- `inactive`
- `rejected`
- `blocked`
- `unknown`

Do not mark a seller listing active merely because:
- The submission was accepted.
- An FSN was generated.
- A product appears in a draft.
- A generic success message was shown.

Require current Seller Hub evidence that the seller's listing is active. Track pickup/location and account restrictions separately.

## 17. Error handling

Use categories:
- `EXISTING_FSN_FOUND`
- `DUPLICATE_PRODUCT_RISK`
- `GTIN_INVALID`
- `GTIN_CONFLICT`
- `BRAND_NOT_AVAILABLE`
- `BRAND_APPROVAL_REQUIRED`
- `CATEGORY_APPROVAL_REQUIRED`
- `PRODUCT_RESTRICTED`
- `COMPLIANCE_DOCUMENT_MISSING`
- `VERTICAL_MISMATCH`
- `MISSING_REQUIRED_ATTRIBUTE`
- `INVALID_ATTRIBUTE_VALUE`
- `VARIANT_ERROR`
- `IMAGE_POLICY_ERROR`
- `CONTENT_POLICY_ERROR`
- `TEMPLATE_ERROR`
- `PROCESSING_ERROR`
- `FSN_CREATION_REJECTED`
- `LISTING_INACTIVE`
- `SELLER_OR_LOCATION_BLOCK`
- `PORTAL_UNAVAILABLE`
- `UNKNOWN`

Recovery:
1. Preserve exact error and affected client SKU/row.
2. Identify whether the issue is catalog, offer, brand, category, compliance, seller account, or pickup location.
3. Separate confirmed reason from suspected cause.
4. Check current official guidance.
5. Request missing data/documents.
6. Correct only validated information.
7. Revalidate the complete affected record.
8. Obtain approval for material changes.
9. Retry only when safe and appropriate.
10. Verify the resulting status in Seller Hub.

Do not repeatedly upload unchanged files. For an uncertain submission outcome, inspect the request/processing status before retrying.

## 18. Security and authorization

- Use only client-authorized seller accounts and data.
- Never request or store passwords, OTPs, recovery codes, or session tokens.
- Account owner completes credentials, OTP, CAPTCHA, and declarations directly.
- Use official Flipkart domains and supported workflows.
- Do not bypass MFA, CAPTCHA, rate limits, bot controls, or account restrictions.
- Store client data in access-controlled, client-isolated storage.
- Never commit client documents, live data, credentials, cookies, or API tokens to GitHub.
- Mask sensitive tax, contact, and banking information in logs/reports.
- Preserve original source files and work on copies.
- Use synthetic data in tests.
- Record client approval and submission evidence.
- Pause if asked to fabricate identifiers, misrepresent brand ownership, or submit false product/compliance claims.

## 19. Commercial plan and listing allowance

SOLLUNA's current plan limits:
- Reseller: 3 new Flipkart listings per billing month.
- Growth: 25 new Flipkart listings per billing month.
- Premium: unlimited, subject to operational feasibility, marketplace rules, agreed processing schedules, and exceptional-work boundaries.

Counting rules:
- Existing FSN mapping does not count as a new listing.
- Track each new product/catalog creation request against the client and billing month.
- Count variant child products according to SOLLUNA's approved listing-count policy; do not silently count a multi-variant family as one listing.
- Ordinary correction/resubmission should not be counted repeatedly unless the commercial agreement explicitly defines it.
- Record failed attempts and cancellations transparently.
- Unlimited listing count does not automatically include unlimited product research, creative production, regulatory research, or exceptional catalog cleanup.
- If the plan allowance is exhausted, pause new listing work and ask a SOLLUNA manager for a decision.
- Never invent additional fees or promise out-of-scope work.

## 20. Output files and handover

Prepare:
1. Product intake sheet.
2. Existing-FSN search/duplicate report.
3. Brand/category/compliance checklist.
4. Vertical-specific product data sheet.
5. Content preview.
6. Image readiness checklist.
7. Variant plan, if applicable.
8. Client approval record.
9. Submission/processing report.
10. Final listing handover report.

Final report includes:
- Client ID.
- Flipkart seller account reference (masked where appropriate).
- Client SKU.
- Product and brand.
- Selected category/sub-category/vertical.
- Existing-FSN search result.
- New FSN, only if confirmed.
- Submission/request reference.
- Catalog processing status.
- Seller listing status.
- Brand/category/compliance blockers.
- Pickup/location or seller-account blockers, if relevant.
- Evidence references and last verification time.
- Pending actions and responsible party.

Final outcomes:
- `ACTIVE_AND_VERIFIED`
- `FSN_CREATED_LISTING_NOT_ACTIVE`
- `SUBMITTED_AWAITING_PROCESSING`
- `CLIENT_ACTION_REQUIRED`
- `BRAND_OR_CATEGORY_BLOCKED`
- `COMPLIANCE_BLOCKED`
- `EXISTING_FSN_MAPPING_REQUIRED`
- `REJECTED_REQUIRES_CORRECTION`
- `CANCELLED`

## 21. Automation and implementation guidance

Suggested deterministic scripts:
- `normalize_flipkart_product_data.py`: normalize safe text and units while preserving originals.
- `validate_product_identifiers.py`: validate GTIN/EAN/UPC formats and check digits.
- `search_existing_fsn_queue.py`: prepare structured search tasks; do not invent search results.
- `validate_vertical_attributes.py`: validate records against a current official vertical template/schema supplied by the user.
- `detect_duplicate_products.py`: detect duplicate SKUs and candidate products.
- `build_flipkart_listing_workbook.py`: prepare a listing workbook from the current supported template.
- `parse_flipkart_processing_report.py`: parse row-level outcomes from an actual Seller Hub report.
- `generate_flipkart_handover.py`: produce summary and exception reports.

Constraints:
- Scripts must be deterministic and independently testable.
- Do not embed credentials or use undocumented endpoints.
- Do not claim automated catalog search unless an authorized supported integration is configured.
- If no supported integration exists, prepare a manual research queue.
- Preserve identifiers as strings in CSV/Excel.
- Use synthetic data for tests.
- Do not scrape or automate in ways that violate marketplace terms or bypass controls.

## 22. Quality assurance and test cases

Use synthetic product records and mock responses only.

Required tests:
1. Exact existing FSN found — new creation blocked.
2. No existing FSN with complete product evidence.
3. Ambiguous catalog match — human review.
4. Invalid GTIN/check digit.
5. Leading-zero identifier preserved.
6. Brand unavailable — route to brand approval.
7. Brand approved but category restricted.
8. Product restricted — submission blocked.
9. Missing compliance evidence.
10. Wrong vertical selection.
11. Missing mandatory vertical attribute.
12. Product title contains unsupported claim.
13. Main image fails current requirements.
14. Product dimensions confused with package dimensions.
15. Incorrect pack count.
16. Unrelated products grouped as variants.
17. Current template changed.
18. Partial processing success.
19. FSN created but seller listing inactive.
20. Seller account/location restriction.
21. Submission timeout — check status before retry.
22. Missing client approval — block submission.
23. Monthly listing allowance exceeded.
24. Sensitive data leakage in logs/reports.

Acceptance criteria:
- Existing FSN check always precedes new creation.
- No fabricated FSNs or product facts.
- Correct vertical and current template used.
- Brand/category/compliance checks completed.
- Client preview and approval recorded.
- Row-level processing results reconciled.
- FSN and seller listing statuses tracked separately.
- Active status supported by current Seller Hub evidence.
- Plan allowance tracked accurately.
- Sensitive information protected.

## 23. Source-of-truth rules

Flipkart category trees, vertical attributes, listing templates, image rules, brand requirements, and approval workflows can change.

Before a definitive recommendation or submission:
1. Check current official Seller Hub instructions and the live workflow.
2. Prefer official Flipkart sources over third-party articles.
3. Record source URL and date checked for material requirements.
4. Use the current vertical-specific template supplied by Seller Hub.
5. Do not hardcode historical field lists, image limits, or upload formats.
6. If official instructions are unavailable or conflicting, mark `UNCONFIRMED` and escalate.

## 24. Execution response format

At task start, state:
- Client ID.
- Flipkart seller account reference.
- Product count received.
- Current billing-month listing allowance and used count.
- Existing-FSN search status.
- Missing product facts/documents.
- Brand/category/compliance blockers.
- Authorization status.

At task end, report:
- New listing candidates.
- Existing FSN matches routed to mapping.
- Products prepared for client review.
- Client approvals obtained/pending.
- Submission and processing outcomes.
- Confirmed FSNs.
- Active, incomplete, rejected, or blocked seller listings.
- Monthly allowance remaining.
- Client actions and SOLLUNA next actions.

A listing is complete only when the catalog product and seller listing have been verified at the appropriate status in Seller Hub. An FSN alone is not proof that the seller's product is available for sale.
