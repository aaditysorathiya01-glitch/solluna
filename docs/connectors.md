# Connector & Skill Map — reuse before you build

Rule: **Existing skills and connectors first → combine or extend → research alternatives only when necessary.**
Verified on 2026-11-05. Recheck before relying on it, because connections change.

## Connected today
| Connector | Account | Use in SOLLUNA |
|---|---|---|
| Google Drive (direct) | aaditysorathiya0@gmail.com | **MVP file delivery:** per-client folders for label batches, monthly report packs, CA documentation packs, thank-you note artwork (`ca-documentation-support`, `daily-label-processing-delivery`, `customized-thank-you-note-design`) |
| Google Sheets (direct) | same | **MVP trackers and workbooks:** P&L workbook, listing quota tracker, low-stock tracker, competitor price log (`monthly-pl-report`, `low-stock-alerts`, `competitor-price-monitoring`) |
| Gmail (via Zapier) | ⚠ fitin15india@gmail.com | Client notifications. **Connect a SOLLUNA sender account before use**: the current account belongs to another brand. |
| Instagram / Facebook Pages / YouTube (via Zapier) | fitin15india accounts | SOLLUNA's own marketing only, not client service delivery. |
| Claude Docs | — | Internal SOPs, proposals, client-facing strategy documents (Premium strategy skills). |

## Decision per platform need
| Need | Use first | Build or add only when |
|---|---|---|
| Report, label and CA file storage | Drive folders (MVP) | Customer portal goes live → S3/R2 behind the API, with signed URLs |
| P&L / tracker spreadsheets | Sheets (MVP) | Data moves into Postgres; Sheets stays as the export format |
| Email / WhatsApp notifications | Zapier → Gmail (after fixing the account) | Volume exceeds about 1k/month → Resend/SES |
| Payments | — (no connector) | **Razorpay required**: no existing alternative |
| Amazon / Flipkart data | — (no connector) | **SP-API / Flipkart Seller API required**. Manual exports until approved. |
| Real-time chat | — | Socket.IO in the platform |

## Gaps (none of the connectors cover these)
Razorpay, Amazon SP-API, Amazon Ads API, Flipkart Seller API. These are the only new integrations the MVP needs.

## Platform wiring (built)
- **Events → Zapier:** the API POSTs every client event (request created/updated, approval requested, subscription activated, payment failed, renewal reminder, grace, past due) to `CONNECTOR_WEBHOOK_URL`, signed with `x-solluna-signature` (HMAC-SHA256 of the body using `CONNECTOR_WEBHOOK_SECRET`). Payload: `type, organizationId, title, body, data, organization{legalName, brandName, contactEmail}`.
- **Delivery channel enforcement:** a task can be completed only with an `outputUrl` on `APPROVED_OUTPUT_HOSTS` (default Google Drive / Docs) or a marketplace confirmation reference.
- **Per-skill connector hints:** `platform/packages/permissions/src/connectors.ts`, shown to operators on every task.

## One-time setup in Zapier (not automatable from here)
1. Create a Zap with trigger **Webhooks by Zapier → Catch Hook**, then copy the URL into `CONNECTOR_WEBHOOK_URL`.
2. Action **Gmail → Send Email** to `organization.contactEmail` with subject `title` and body `body`, from a **SOLLUNA** Gmail account (not fitin15india).
3. Optional action: **Google Sheets → Create Spreadsheet Row** in an "Ops event log" sheet.
