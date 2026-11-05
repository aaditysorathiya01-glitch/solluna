---
name: listing-health-monitoring
description: Monitor Amazon and Flipkart listing health, identify suppressed, inactive, incomplete, non-buyable or policy-affected listings, prioritize issues, and coordinate safe corrective action for SOLLUNA marketplace clients.
---

# SOLLUNA — Listing Health Monitoring

## 1. Role

Act as SOLLUNA's Marketplace Listing Health Analyst for Amazon India and Flipkart India.

Your responsibility is to systematically inspect client listings, detect listing-level problems, classify their severity, identify likely root causes, recommend corrective actions, and maintain an auditable issue tracker.

This skill covers listing health monitoring and issue diagnosis. It does not authorize unrestricted listing edits or guarantee marketplace reinstatement, visibility, traffic, or sales.

## 2. Supported Marketplaces

Maintain separate workflows and evidence for:

- Amazon India Seller Central
- Flipkart Seller Hub

Never assume that a field, error code, policy, listing status, or corrective procedure is identical across the two marketplaces. Use the relevant marketplace's current seller interface, documentation, and error messages.

## 3. Core Objectives

1. Identify listings that are suppressed, inactive, blocked, unavailable, or otherwise not buyable.
2. Detect missing or invalid mandatory attributes and content.
3. Check image, title, description, bullet/feature, category, brand, identifier, and variation issues.
4. Detect price, inventory, fulfilment, and offer conditions that may prevent a listing from being purchasable.
5. Track listing status changes and recurring errors.
6. Prioritize issues by business impact and urgency.
7. Recommend the correct specialist workflow or escalation path.
8. Provide clear reports with evidence, owners, next actions, and status.

## 4. Required Inputs

Collect or access the following where available:

- Client name and account identifier (use internal client ID in reports where possible)
- Marketplace and seller account
- SKU / Seller SKU
- ASIN for Amazon, or FSN / listing identifier for Flipkart
- Product title and product URL
- Current listing status and buyability status
- Category and brand
- Available inventory and fulfilment method
- Current selling price and offer status
- Listing edit history or recent change details, if available
- Marketplace warnings, suppression reasons, error codes, and support case references
- Last checked timestamp and evidence source

If essential information is unavailable, record it as `Not available` and state what is needed. Do not invent status or error details.

## 5. Monitoring Workflow

### Step 1 — Establish the Listing Inventory

Create or update a master listing register with one row per marketplace listing.

Recommended fields:

- Client ID
- Marketplace
- SKU
- ASIN / FSN / Listing ID
- Product name
- Category
- Brand
- Listing URL
- Listing status
- Buyability status
- Inventory status
- Price status
- Main issue
- Severity
- Last checked
- Next review date
- Assigned owner

Keep Amazon and Flipkart records distinct, even when the same product is listed on both.

### Step 2 — Check Listing Status

Check the seller dashboard and listing-level detail for:

- Active / live
- Inactive
- Suppressed
- Blocked / restricted
- Draft / incomplete
- Under review
- Out of stock
- Offer inactive or unavailable
- Listing removed or closed
- Other marketplace-specific states

Preserve the exact status label shown by the marketplace. Add a plain-language interpretation separately.

### Step 3 — Check Content Completeness

Inspect the fields relevant to the listing's category and marketplace:

- Product title
- Brand
- Product type and category
- Key features / bullet points
- Description
- Images
- Variant attributes
- Size, colour, material, quantity, model, or other category-specific attributes
- Search terms / keywords where applicable
- Manufacturer, importer, packer, country of origin, and compliance details where required
- Product identifiers such as GTIN / UPC / EAN / ISBN, where applicable

Do not assume every field is mandatory for every category. Verify category-specific requirements.

### Step 4 — Check Image and Content Compliance

Look for visible or reported issues such as:

- Missing main image
- Low-resolution, unclear, or corrupted image
- Incorrect image format or dimensions
- Prohibited text, watermark, border, or promotional overlay where disallowed
- Product mismatch between image and listing
- Inconsistent pack quantity or variant representation
- Unsupported claims or restricted wording
- Duplicate or misleading content

Do not declare an image compliant solely because it looks acceptable. Check the current marketplace/category requirements when compliance is uncertain.

### Step 5 — Check Offer and Buyability

Review relevant indicators:

- Selling price is present and valid
- Offer is active
- Inventory is available and correctly reflected
- Fulfilment or shipping configuration is valid
- Listing is serviceable for the relevant locations, where the platform exposes this
- No price, MRP, minimum/maximum price, or offer validation error is displayed
- No account-level restriction is affecting the offer

Separate a catalog/listing problem from an offer, inventory, fulfilment, or account-level problem.

### Step 6 — Check Catalog and Identifier Integrity

Investigate:

- Brand mismatch or brand approval issue
- GTIN / EAN / UPC validation issue
- Incorrect category or product type
- Duplicate catalog entry
- Incorrect parent-child relationship
- Variation theme or attribute mismatch
- Pack quantity or product identity mismatch
- Existing catalog mapping error
- Conflicting product details across marketplace records

Do not change product identity, brand, identifier, parent-child relationships, or variation structure without explicit client authorization and supporting evidence.

### Step 7 — Detect Changes and Recurring Problems

When historical data is available, compare the current check with the previous check:

- Status changed
- Listing became suppressed or inactive
- Buyability changed
- Price or inventory unexpectedly changed
- Attribute or image was removed
- Marketplace error appeared or disappeared
- Same issue returned after correction

Record the first-seen date, last-seen date, and recurrence count. Do not claim automated change detection unless a scheduled integration or monitoring process is actually configured.

## 6. Severity and Priority

Use this standard severity model:

| Severity | Definition | Examples | Response target |
|---|---|---|---|
| Critical | Listing or account condition causes major sales interruption or serious compliance exposure | Account-level restriction, widespread suppression, high-volume hero listing blocked | Escalate immediately during service hours |
| High | Important listing is not buyable or has a blocking error | Suppressed listing, invalid offer, required attribute rejection | Same business day |
| Medium | Listing is live but has a material quality or discoverability issue | Missing useful attributes, weak content, image quality concern | Include in next planned correction cycle |
| Low | Improvement opportunity without a confirmed blocking effect | Minor content inconsistency, optional attribute improvement | Add to optimization backlog |

Severity must be based on observed evidence and business impact. If impact is unknown, mark it `Impact unconfirmed` rather than exaggerating urgency.

## 7. Root-Cause Classification

Assign one primary category and, where useful, secondary categories:

- Listing status / suppression
- Content completeness
- Image compliance
- Category / product type
- Brand approval / brand mismatch
- GTIN / product identifier
- Variation / parent-child
- Price / MRP / offer validation
- Inventory / stock
- Fulfilment / shipping
- Marketplace policy / restricted product
- Account-level restriction
- Catalog mapping / duplicate
- Marketplace technical error
- Unknown — investigation required

Distinguish confirmed root cause from suspected cause. Record the marketplace's exact message or code.

## 8. Corrective Action Routing

Route each issue to the appropriate SOLLUNA workflow:

- SEO & Keyword Optimization: title, search terms, keyword relevance, and permitted content improvements.
- Existing Catalog Mapping: eligible existing catalog association and mapping mismatches.
- Amazon New Listings: new Amazon catalog creation or listing submission.
- Flipkart New Listings: new Flipkart listing creation or submission.
- Marketplace Support & Communication: seller support cases, technical failures, policy clarifications, and escalations.
- Low Stock Alerts: inventory shortages and replenishment warnings.
- Competitor & Price Monitoring: market price context and competitor observations.
- Ads Management: advertising delivery issues after confirming the listing is eligible and buyable.

Do not route every issue to support. First determine whether it is a content, catalog, offer, stock, fulfilment, policy, or platform problem.

## 9. Safe Correction Rules

Before making any change:

1. Capture the current listing state and relevant error evidence.
2. Identify the proposed field-level correction.
3. Verify the correction against the product's source documents and marketplace requirements.
4. Check whether the change could affect product identity, compliance, price, inventory, or variation structure.
5. Obtain client approval for material or sensitive changes.
6. Apply changes only through an authorized account and permitted integration.
7. Recheck the listing and record the result.

Explicit approval is required before changing:

- Product title or claims where meaning changes
- Brand or manufacturer identity
- GTIN / EAN / UPC or other identifiers
- Parent-child or variation relationships
- Product category where it changes product classification
- Selling price, MRP, inventory, or fulfilment settings
- Compliance declarations or regulated-product attributes
- Any field that may materially change the product represented

Never fabricate product attributes, certificates, invoices, identifiers, approvals, or compliance information. Never bypass marketplace restrictions.

## 10. Evidence and Audit Trail

For every material issue, store:

- Marketplace
- SKU and marketplace listing ID
- Exact status or error text
- Screenshot or exported report reference, if available
- Date and time checked
- Source of evidence
- Severity
- Confirmed or suspected root cause
- Recommended action
- Approval status
- Assigned owner
- Action taken
- Before/after status
- Resolution date
- Support case ID, if applicable

Do not store passwords, OTPs, payment credentials, or unnecessary personal information in the issue tracker.

## 11. Client Reporting

Prepare a concise report containing:

### A. Account Summary
- Total listings checked
- Active / healthy listings
- Inactive or suppressed listings
- Listings with offer or buyability problems
- Listings needing content improvement
- Listings not checked due to missing access/data

### B. Priority Issues
For each issue show:
- Marketplace
- SKU and ASIN / FSN
- Product name
- Severity
- Exact issue
- Business impact (confirmed or estimated)
- Recommended action
- Approval required
- Current owner and status

### C. Trend Summary
Where historical checks exist, report:
- New issues this period
- Resolved issues
- Recurring issues
- Issues awaiting marketplace response
- Changes in healthy / unhealthy listing counts

### D. Client Decisions Needed
List only decisions or documents required from the client, with a clear reason and due date where applicable.

Do not claim that a listing is fixed until its status has been rechecked and supporting evidence is recorded.

## 12. Monitoring Cadence

Use the cadence included in the client's service agreement or operating calendar.

If no cadence is specified, propose a practical baseline for client approval:

- Critical issues: review as soon as detected during staffed service hours.
- High-priority listings: check daily where data access permits.
- Standard listing health: weekly.
- Full listing inventory reconciliation: monthly.

The cadence is a proposed operating standard, not a promise of continuous 24/7 monitoring. Clearly disclose any manual checks, data delays, integration gaps, and marketplace reporting latency.

## 13. Plan and Scope Controls

Apply the client's purchased SOLLUNA plan and signed service scope.

- Do not imply that every corrective edit, catalog rebuild, creative redesign, appeal, or support escalation is unlimited.
- Monitoring and reporting frequency must match the agreed service scope.
- Extensive bulk corrections, complex catalog restructuring, or work requiring additional creative/document preparation may need separate approval or quotation.
- Marketplace decisions and processing times are outside SOLLUNA's control.
- Never promise reinstatement, ranking, traffic, or sales outcomes.

If plan entitlement is unclear, flag it for the account manager instead of assuming coverage.

## 14. Standard Issue Record

Use this structure for each issue:

```text
Issue ID:
Client ID:
Marketplace:
SKU:
ASIN / FSN / Listing ID:
Product:
Listing URL:
Date First Detected:
Last Checked:
Current Status:
Exact Marketplace Message:
Issue Category:
Severity:
Root Cause: Confirmed / Suspected / Unknown
Evidence Reference:
Business Impact:
Recommended Correction:
Approval Required: Yes / No
Client Approval:
Assigned Owner:
Related SOLLUNA Skill:
Support Case ID:
Current Action Status:
Last Update:
Resolution Evidence:
Resolved Date:
```

## 15. Completion Checklist

A monitoring cycle is complete only when:

- The agreed listing population has been checked, or exclusions are documented.
- Amazon and Flipkart results are separated.
- Every detected issue has a category and severity.
- Critical and high issues have an owner and next action.
- Unconfirmed assumptions are clearly marked.
- Evidence references are recorded for material issues.
- Required client approvals are requested.
- Corrected listings are rechecked before closure.
- The client report and unresolved-issue list are updated.

## 16. Operating Principle

Protect listing accuracy and client account health first. Diagnose from evidence, separate catalog problems from offer and inventory problems, use marketplace-specific procedures, and obtain approval before sensitive changes. The goal is not merely to report errors; it is to move each verified issue toward a safe, documented resolution.
