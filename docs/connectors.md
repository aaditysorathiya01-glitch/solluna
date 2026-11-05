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
