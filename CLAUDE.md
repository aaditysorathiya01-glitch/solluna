# SOLLUNA — Repository Context

Two things live in this repo. Know which one you are touching.

| Path | What | Rule |
|---|---|---|
| `/` (`index.html`, `style.css`, `script.js`, `images/`, `CNAME`) | **Live website** for solluna.co.in (GitHub Pages) | Don't modify unless the task is explicitly about the website. |
| `.claude/skills/` | **29 SOLLUNA operating skills** — 1 orchestrator + 28 specialist services | Source of truth for *how* each service is delivered. |
| `docs/plans/` | Plan matrix (`SOLLUNA_Marketplace_Management_Plans.txt`) + platform build plan | Plan matrix = source of truth for *what* each plan includes. |
| `platform/` | SOLLUNA 2.0 marketplace-management SaaS (Next.js + NestJS + Prisma + BullMQ) | Build here. |

## Operating priority: Skills & Connectors first
1. **Any client/service task → start with `solluna-skill-orchestrator`.** It classifies the request, checks the plan, routes to the specialist skill, enforces approvals.
2. Specialist skills execute; never improvise a process a skill already defines.
3. Before adding any dependency, tool, API or integration, check `docs/connectors.md`. Reuse or combine existing connectors first; research alternatives only when nothing existing can do it.
4. Never claim a skill or connector ran if it isn't installed or connected.

## Plans (from the plan matrix)
**Reseller ₹1,999 · Growth ₹4,999 · Premium ₹9,999** — Amazon + Flipkart only.
- New listings 3 / 25 / Unlimited per marketplace per billing month.
- Call support — / On Request / Priority.
- Growth+: ads, promotions, low stock, competitor and price monitoring, listing health, inventory planning, shipping labels, daily label processing.
- Premium only: personalized thank-you notes, custom thank-you design, and the 6 strategy services.

## Single source of truth chain
`plan matrix` ↔ `platform/packages/permissions/src/features.ts` (28 keys, each → one skill) ↔ `.claude/skills/<skill>` ↔ orchestrator directory.
Run `cd platform && npm run verify:skills` after changing any of them; it fails on drift.

## Platform non-negotiables
1. **Tenant isolation:** every tenant row has `organizationId`; every query is scoped by it.
2. **Plan limits live in the DB** (`PlanFeature`, admin-editable) and are enforced in the API (`checkEntitlement`), never by hiding UI. If the plan can't be verified, the result is `PENDING_VERIFICATION`.
3. **Approvals** (`Approval` model) are action-specific and required before: ad spend or budget changes, purchases, marketplace fees, price or offer changes, material listing changes, consequential order actions, third-party data sharing, and out-of-plan work.
4. **Status is evidence-based:** never mark ACTIVE, COMPLETED or OPTED_OUT without marketplace confirmation.
5. **Payments:** activate only after Razorpay server signature check + webhook. Prices are **GST-exclusive** (18% added); every verified payment issues a GST tax invoice (`apps/api/src/billing/gst.ts`).
6. **Credentials:** OAuth tokens only, encrypted. Never passwords or OTPs in chat. No production reliance on scraping.
7. **P&L:** never show verified profit with missing costs. Mark it ESTIMATED or UNAVAILABLE.
8. **Labels:** never alter official marketplace labels. Thank-you notes are separate inserts.
9. **Naming:** customer-facing support is "Manager Chat Support".
10. Heavy jobs (labels, reports, syncs, monitoring) run in the worker, never inside HTTP requests.

## Status vocabularies (from the skills, mirrored in `schema.prisma`)
- Task (orchestrator): NEW · AWAITING_INFORMATION · AWAITING_CLIENT_APPROVAL · PLAN_VERIFICATION · QUEUED · IN_PROGRESS · BLOCKED · UNDER_MARKETPLACE_REVIEW · COMPLETED · PARTIALLY_COMPLETED · CANCELLED
- Priority (manager-chat-support): P1 30-min ack · P2 2 business hrs · P3 1 business day · P4 2 business days
- Listings: amazon-new-listings §15 / flipkart-new-listings §16
- Catalog mapping confidence: existing-catalog-mapping §7
- Promotions: promotional-management §10
- Stock severity: low-stock-alerts §7
