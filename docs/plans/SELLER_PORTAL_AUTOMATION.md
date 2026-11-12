# Seller-portal automation (interim, until official APIs)

Owner decision, 7 Nov 2026: option B — automated work in Amazon Seller Central and Flipkart Seller Hub through SOLLUNA's own user, until SP-API / Ads API / Flipkart Seller API are approved. The owner accepted the marketplace-policy risk; clients accept it in Terms §6 at every plan purchase.

## Access model
- One SOLLUNA ops user for all clients: Role, Name, Email, Phone from `OPS_USER_ROLE / OPS_USER_NAME / OPS_USER_EMAIL / OPS_USER_PHONE` (defaults: Admin, SOLLUNA Operations, ops@solluna.co.in). Shown to clients on Seller accounts → "Add a new user".
- Client passwords / OTPs are never requested or stored. OTPs arrive in SOLLUNA's own mailbox / SIM.
- AI managers do not get separate marketplace IDs. Manager changes need nothing from the client.
- Status turns CONNECTED only after the invite is accepted and access is confirmed (evidence note).

## Built (7 Nov 2026)
- Terms §6 "Seller account access and automation"; checkout and test activation require the "I agree" checkbox; `Subscription.termsVersion` + `termsAcceptedAt` + audit `terms.accepted`.
- Seller accounts page: step-by-step "Add a new user" with the exact values and copy buttons.

## To build once inputs are ready
| Part | Notes |
|---|---|
| Automation worker | Separate process (never inside HTTP requests); headless Chromium with one persistent, encrypted browser profile per marketplace for the ops login. Cannot run on the Render free preview (512 MB) — needs the production server. |
| OTP reader | Reads OTP mails from the ops mailbox (IMAP, app password stored encrypted in env) — or SMS forwarder for the ops SIM. |
| Account switcher | Selects the client's seller account inside the ops login before each job; aborts if the visible seller ID ≠ the client's saved seller ID. |
| Safeguards | URL allow-list per job type; hard block on bank, payment, settlement, user-permission and account-settings pages; max actions per client per day; human-like pacing; screenshot + log for every action in the audit trail; approvals enforced before price, ads, offers, material listing and order actions. |
| First jobs | Read-only first: order list + label download (daily label processing), inventory / low-stock read, listing status. Writes next: bulk-file uploads (listings, price, stock) after approval. |
| Kill switch | `PORTAL_AUTOMATION=off` stops all jobs; any CAPTCHA, verification prompt or policy warning stops the client's jobs and alerts ops. |

## Inputs needed from the owner
1. Business email on solluna.co.in (Zoho / Google) with the ops mailbox, and IMAP access for the OTP reader. DNS (MX) changes are done by the owner.
2. Ops business SIM / number (`OPS_USER_PHONE`).
3. Test: add the ops email as a user on two different Flipkart seller accounts (one login across many accounts must work), and the same on Amazon.
4. One test seller account per marketplace for building and testing the jobs.
5. Production server (DigitalOcean BLR) — the worker needs more than the free preview.

## Exit
Move each job to the official API as soon as it is approved; then remove portal automation for that job.

## Decision 12 Nov 2026 (owner)
Not waiting for API approvals. Main path = **AI browser on SOLLUNA's server** with the ops login: fixed Playwright steps for known flows, Claude Haiku 5.5 (computer use) only when a page changes or a step gets stuck. Phase 1 = read-only report downloads (Flipkart P&L + CA files, Amazon MTR B2B/B2C + fee invoices), piloted on the owner's own accounts. Browser extension (OPEN_DISCUSSIONS §7) = backup for clients whose server login gets blocked. Client API-keys card removed from the Seller accounts page.
Inputs needed to start the pilot: ops@solluna.co.in mailbox with IMAP app password in the server env (`OPS_MAIL_PASSWORD`), mail provider name, ops user added on the owner's Flipkart and Amazon accounts.
