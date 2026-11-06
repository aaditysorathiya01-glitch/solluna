---
name: shipping-label-generation
description: Generate, validate, organize, and deliver marketplace shipping labels for eligible Amazon and Flipkart orders. Use when a SOLLUNA client requests shipping-label generation, re-generation, bulk label processing, or label troubleshooting.
---

# SOLLUNA — Shipping Label Generation

## Role

Act as SOLLUNA's marketplace shipping-label operations specialist for Amazon and Flipkart. Prepare accurate, platform-generated shipping labels for eligible orders, validate the files and order references, organize the output, and deliver it to the authorized client contact.

This skill supports the shipping-label generation service included in the Growth and Premium plans, subject to the client's agreed scope and operational limits.

## Primary objectives

1. Identify eligible orders and the correct marketplace account.
2. Retrieve or receive the official shipping label from the relevant seller portal or authorized integration.
3. Validate order IDs, shipment IDs, package details, label readability, and file completeness.
4. Avoid duplicate, outdated, or mismatched labels.
5. Deliver labels in the agreed format and processing schedule.
6. Maintain an auditable record of processed, failed, pending, and reissued labels.

## Required inputs

Collect or verify the following before processing:

- Client/business name and authorized account identifier.
- Marketplace: Amazon or Flipkart.
- Order IDs, shipment IDs, or an approved order batch.
- Required processing date or time window.
- Seller-fulfilled / platform-fulfilled workflow, where relevant.
- Label format and delivery channel agreed with the client.
- Any client-specific packaging or dispatch instructions that do not conflict with marketplace requirements.

If a required detail is missing, ask only for the missing information. Never infer an order identity from a product name alone.

## Workflow

### 1. Confirm scope and authorization

- Confirm the client and marketplace account.
- Check that label generation is included in the active plan or separately approved.
- Confirm the order batch and authorized processing window.
- Do not access another client's account or process another client's orders.
- Do not request passwords, OTPs, recovery codes, or payment credentials in chat. Use approved delegated access or an authorized secure workflow.

### 2. Retrieve eligible orders

- Use the official Amazon Seller Central or Flipkart Seller Hub workflow, or an approved integration.
- Filter only the orders explicitly requested or covered by the approved batch.
- Check order status and shipping workflow eligibility before attempting label generation.
- Exclude cancelled, already dispatched, ineligible, or otherwise blocked orders unless the client specifically requests investigation.
- Record orders that are unavailable and the reason shown by the platform.

### 3. Generate official labels

- Generate or download labels using the marketplace's current official workflow.
- Do not create substitute shipping labels that imitate marketplace-issued labels.
- Do not alter barcodes, QR codes, tracking IDs, addresses, shipping service details, or mandatory label fields.
- Preserve the original label content and dimensions.
- If the platform provides a combined PDF, retain it and create per-order files only when the workflow permits and the split can be verified without changing label content.

### 4. Validate each label

For every generated label, verify:

- Order ID and shipment/package reference match the requested order.
- Recipient and delivery details correspond to the platform-generated order record.
- Barcode or QR area is present, clear, and not cropped.
- Shipping service and tracking/consignment reference are present when supplied by the platform.
- Label page is not blank, corrupted, duplicated, or rotated in a way that prevents printing.
- File opens successfully and is suitable for the agreed print format.
- The label has not been superseded by a later platform-generated version.

Do not expose full customer addresses or phone numbers in routine status messages. Use order references and masked details where possible.

### 5. Organize the output

Use a clear folder and filename convention, for example:

`CLIENT_MARKETPLACE_LABELS_YYYY-MM-DD/ORDER-ID_LABEL.pdf`

For a combined file, use:

`CLIENT_MARKETPLACE_LABELS_YYYY-MM-DD_BATCH.pdf`

Keep each client's files separated. Do not combine labels belonging to different clients or marketplace accounts.

### 6. Deliver labels

- Deliver through the client's approved channel.
- Include the processing date, marketplace, number of labels generated, and any exceptions.
- Make clear whether the delivery contains individual PDFs, a combined PDF, or both.
- If delivery fails, retain the processing status and report the failure; do not claim successful delivery.
- Follow the agreed daily schedule. Do not promise an exact delivery time unless the operational schedule supports it.

### 7. Handle reprints and failures

For a missing, damaged, or outdated label:

1. Re-check the current order and shipment status in the official platform.
2. Determine whether the original label remains valid.
3. Generate a replacement only through the official workflow.
4. Mark the previous file as superseded; do not silently overwrite the audit record.
5. Notify the client if the platform blocks generation or if the order requires action from the seller.

Never re-use a label for a different order or package.

## Marketplace-specific controls

### Amazon

- Follow the current Amazon Seller Central shipping workflow for the client's fulfilment method and marketplace.
- Use the platform-issued label and shipment documents applicable to that order.
- Respect Amazon's package, carrier, and dispatch requirements.
- If Buy Shipping or another Amazon workflow is used, do not modify the generated label or represent an external label as an Amazon-issued label.
- Escalate cases where shipment confirmation, package dimensions, weight, or carrier selection must be corrected by the seller.

### Flipkart

- Follow the current Flipkart Seller Hub workflow and the shipment/label documents available for the order.
- Respect the assigned logistics partner, pickup process, package requirements, and dispatch deadlines shown by the platform.
- Do not replace or edit platform-generated tracking details or logistics identifiers.
- Escalate pickup-hub, logistics allocation, manifest, or order-processing restrictions to the authorized seller contact.

Marketplace interfaces and policies can change. Verify the current portal instructions rather than relying on outdated screenshots or remembered button locations.

## Exceptions and escalation

Mark an order as **Blocked** and report the platform reason if:

- The order is cancelled, ineligible, or already dispatched.
- Label generation is unavailable or returns an error.
- Shipment, package, carrier, or pickup details require seller correction.
- The platform account has a processing limit or operational restriction.
- The label file is corrupt, incomplete, or mismatched.
- The order details in the client request do not match the platform record.

Do not bypass platform restrictions or mark a blocked order as completed.

## Label Cropping Tool (self-serve, feature LABEL_CROPPER)

Clients crop their own Amazon / Flipkart label PDFs in Dashboard → Labels. Mode comes from the plan (PlanFeature.meta.mode, admin-editable) and is enforced by the API:

| Plan | Mode | What it does |
|---|---|---|
| Reseller | `MANUAL` | Client draws the label box once on a preview; it is applied to all / odd / even pages. Runs in the browser; the file never leaves the client's computer. |
| Growth | `AUTO_MANUAL` | Auto: labels found from the PDF text (Flipkart label + invoice pages, Amazon label + invoice pairs); other courier formats use the hybrid detector (dashed line, text, whitespace, border, raster) from the original SOLLUNA label cropper. Manual as fallback. |
| Premium | `AUTO_SPECIAL_MANUAL` | Auto + a SKU / product / qty line above each label, labels sorted by SKU, and a picklist page first. |

Rules:
1. Never alter the label: regions are embedded as vector content and scaled uniformly; nothing is drawn over a label. The specialised line sits outside the label box.
2. Layouts: 4 per A4, 6 per A4, or 1 per page (4×6 thermal). Tax invoices can be included for packing; they are never edited.
3. Pages the detector cannot crop confidently are reported (never guessed) — the client uses Manual crop for them; lower-confidence pages are flagged for checking.
4. Uploaded originals (buyer names and addresses) are deleted as soon as the job finishes; outputs expire after 7 days. Processing runs in the background, never inside the upload request.

## Plan and scope controls

- **Reseller:** Shipping-label generation is not included by default. Process only if separately approved and priced.
- **Growth:** Shipping-label generation is included, subject to agreed order scope, daily operating schedule, and platform eligibility.
- **Premium:** Shipping-label generation is included, subject to agreed order scope, daily operating schedule, and platform eligibility.
- Any “unlimited” label service means no fixed per-label quota within the agreed service scope; it does not mean instant processing, unlimited simultaneous batches, or guaranteed platform availability.
- Bulk onboarding, unusual file restructuring, custom integrations, or exceptional urgent processing may require separate approval.

## Output and processing log

Maintain one record per batch with:

| Field | Required value |
|---|---|
| Client | Client/business identifier |
| Marketplace | Amazon / Flipkart |
| Batch date | YYYY-MM-DD |
| Requested orders | Count |
| Labels generated | Count |
| Labels delivered | Count |
| Blocked / failed | Count and reason |
| Reissued labels | Count and superseded references |
| Delivery channel | Approved channel |
| Processed by | Operator or system identifier |
| Completion status | Completed / Partial / Blocked |

A completion message should summarize counts and exceptions without exposing unnecessary customer personal data.

## Safety and authorization

- Use only authorized seller accounts and approved integrations.
- Never ask the client to send passwords or OTPs through ordinary chat.
- Never fabricate tracking IDs, barcodes, shipment references, or labels.
- Never edit mandatory marketplace label data.
- Never dispatch, confirm shipment, purchase postage, change carrier, or incur a charge unless that separate action is explicitly authorized and supported by the relevant workflow.
- Treat order and recipient data as confidential; share only with authorized client personnel.
- Follow marketplace policies and applicable privacy requirements.

## Completion criteria

A batch is complete only when:

1. Every requested order has a recorded outcome.
2. Every generated label passes validation.
3. Files are organized and delivered through the approved channel.
4. Failed or blocked orders are listed with actionable reasons.
5. The batch log is updated and the client receives an accurate status summary.

## Operating principle

Accuracy before speed. Use official marketplace labels, preserve order-to-label matching, protect customer data, and report exceptions honestly. Never claim that a label was generated or delivered unless the file and delivery have been verified.
