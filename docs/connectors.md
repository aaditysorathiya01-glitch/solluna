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
| Amazon data | **Amazon SP-API** (`SPAPI_CLIENT_ID`, `SPAPI_CLIENT_SECRET` = SOLLUNA's app; `SPAPI_TEST_REFRESH_TOKEN` = owner's test seller), added 2026-11-10: Login with Amazon token → EU endpoint (Amazon.in `A21TJRUUN4KGV`). Admin → Overview → "Test Amazon connection". Clients can also paste their own app keys on Seller accounts (encrypted, write-only, tested at once). Per-client tokens: `MarketplaceCredential` (encrypted) | Reports, settlements, catalog next |
| Flipkart data | — (no connector) | Flipkart Seller API required. Manual exports until approved. |
| Client manager in Manager Chat (onboarding, facts, requests, escalation) | **Claude API, Claude Haiku 5.5** (`ANTHROPIC_API_KEY`, `MANAGER_AGENT_MODEL`), added 2026-11-07; per-client memory + tenant-bound tools; cost per client in Admin → Manager cost | No limits yet (owner watching spend) — add per-client caps if cost requires |
| Product details from a link / ASIN / FSN (listing forms) | **Claude API web search + web fetch** (`ANTHROPIC_API_KEY`), added 2026-11-07 — no existing connector finds product data | SP-API Catalog Items approved → use it first for Amazon; keep Claude for Flipkart and other sites |
| Real-time chat | — | Socket.IO in the platform |

## Gaps (none of the connectors cover these)
Razorpay, Amazon SP-API, Amazon Ads API, Flipkart Seller API, and the Claude API (product lookup for the listing forms).

## Platform wiring (built)
- **Events → Zapier:** the API POSTs every client event (request created/updated, approval requested, subscription activated, payment failed, renewal reminder, grace, past due) to `CONNECTOR_WEBHOOK_URL`, signed with `x-solluna-signature` (HMAC-SHA256 of the body using `CONNECTOR_WEBHOOK_SECRET`). Payload: `type, organizationId, title, body, data, organization{legalName, brandName, contactEmail}`.
- **Delivery channel enforcement:** a task can be completed only with an `outputUrl` on `APPROVED_OUTPUT_HOSTS` (default Google Drive / Docs) or a marketplace confirmation reference.
- **Per-skill connector hints:** `platform/packages/permissions/src/connectors.ts`, shown to operators on every task.

## One-time setup in Zapier (not automatable from here)
1. Create a Zap with trigger **Webhooks by Zapier → Catch Hook**, then copy the URL into `CONNECTOR_WEBHOOK_URL`.
2. Action **Gmail → Send Email** to `organization.contactEmail` with subject `title` and body `body`, from a **SOLLUNA** Gmail account (not fitin15india).
3. Optional action: **Google Sheets → Create Spreadsheet Row** in an "Ops event log" sheet.
- **Product lookup:** `POST /api/catalog-forms/lookup` queues a background job; Claude (`claude-haiku-5-5` with the basic web search / fetch tools, `LOOKUP_MODEL` to change) searches the web and fetches the pasted link, then returns details through a strict `submit_product_details` tool. Results only pre-fill empty form fields, marked "from web — check"; the same product is reused for 7 days; `LOOKUP_DAILY_LIMIT` (default 25) per client per day. Without `ANTHROPIC_API_KEY` the button is hidden and clients fill the form manually. Our servers never scrape marketplace pages.
