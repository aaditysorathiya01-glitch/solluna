# SOLLUNA 2.0 – Complete Website Development Pipeline & Business Plan

> Source of truth for product scope, plans, workflows and build order.
> Domain: **solluna.co.in** · Market: India · Positioning: premium.

**Project:** SOLLUNA – Amazon & Flipkart Marketplace Management Platform

**Objective:** A professional website where sellers explore service plans, subscribe, onboard marketplace accounts, access reports, request support and talk to their assigned manager — plus a centralized internal system to manage clients, listings, advertising, orders, shipping labels, reports and service delivery.

**Core principle:** Build SOLLUNA as a multi-tenant marketplace-management SaaS with a service-delivery backend — not a marketing site with a chat widget. The business value is the operational system behind the website.

**Naming rule:** The customer-facing service is always called **Manager Chat Support**. Automation/AI may run internally but is never the service name.

---

## 1. Technology Stack

| Layer              | Technology                                 |
| ------------------ | ------------------------------------------ |
| Frontend           | Next.js + React.js                         |
| Styling            | Tailwind CSS                               |
| Backend            | Node.js + NestJS                           |
| Database           | PostgreSQL                                 |
| ORM                | Prisma                                     |
| Authentication     | Auth.js or secure JWT-based authentication |
| Background Jobs    | Redis + BullMQ                             |
| File Storage       | AWS S3 or Cloudflare R2                    |
| Payments           | Razorpay                                   |
| Email              | Resend or Amazon SES                       |
| Real-time Chat     | Socket.IO                                  |
| Charts & Reports   | Recharts                                   |
| AI Integration     | Separate model API and agent service       |
| Browser Automation | Playwright                                 |
| Deployment         | Cloud server / VPS with Docker             |
| Version Control    | GitHub                                     |

Next.js handles the website and dashboards. NestJS handles business logic, marketplace integrations, background processing and internal management. Tailwind is used everywhere for one consistent, responsive design system.

## 2. Platform Structure

```
solluna.co.in
├── Public Website      Home, Services, Pricing, About, Contact, FAQ
├── Customer Portal     Login, Dashboard, Reports, Listings, Chat, Labels
├── Admin Dashboard     Clients, Plans, Payments, Tasks, Team, Operations
├── Manager Workspace   Assigned clients, requests, communication, follow-ups
├── NestJS API + PostgreSQL   Business logic, permissions, integrations, files, automation
└── External Services   Amazon SP-API · Flipkart APIs · Razorpay · Email · Storage · AI
```

## 3. Public Website

| Page                         | Purpose                                          |
| ---------------------------- | ------------------------------------------------ |
| Home                         | Explain SOLLUNA's services and value proposition |
| About Us                     | Company information and credibility              |
| Services                     | Complete Amazon and Flipkart service details     |
| Pricing                      | ₹1,999, ₹4,999 and ₹9,999 plans                  |
| Contact Us                   | Contact form, phone and email                    |
| FAQ                          | Common seller questions                          |
| Login / Register             | Customer authentication                          |
| Terms & Conditions           | Service scope, limitations and payment terms     |
| Privacy Policy               | Data collection, use and protection              |
| Refund & Cancellation Policy | Subscription cancellation and refund rules       |

**Homepage sections:** 1) Hero – marketplace management for Amazon & Flipkart · 2) Services overview · 3) How SOLLUNA works · 4) Three pricing plans · 5) Why choose SOLLUNA · 6) Onboarding process · 7) FAQ · 8) Contact + subscription CTA.

## 4. Customer Dashboard (most important surface)

Every customer gets a separate, private dashboard.

**Navigation:** Overview · My Subscription · Amazon Account · Flipkart Account · Product Listings · Catalog Mapping · Advertising & Promotions · Inventory & Low Stock Alerts · Shipping Labels · Business Reports & P&L · CA Documents · Support Tickets · Manager Chat · Documents & Files · Billing & Payments · Account Settings

- **A. Overview** – current plan + renewal date, connected marketplaces, active products, listing/mapping progress, pending requests, recent reports, account alerts.
- **B. Product Listings** – submit requests, upload images/info, track status, view completed listings, download listing documents.
- **C. Catalog Mapping** – submit mapping requests with ASIN/FSN/product info, track progress, view results.
- **D. Shipping Labels** – daily eligible orders, download labels, download Thank You Notes (Premium), processing/delivery status.
- **E. Business Reports** – monthly sales, returns/cancellations, marketplace fees, settlements, P&L, CA documents.
- **F. Manager Chat** – private customer–manager chat, attachments, history, support requests, status updates.

## 5. Admin Dashboard

| Module                  | Admin Functions                                              |
| ----------------------- | ------------------------------------------------------------ |
| Client Management       | Add, edit, suspend and manage customers                      |
| Subscription Management | Assign plans, upgrade, downgrade and renew                   |
| Payment Management      | Track payments, invoices and failed payments                 |
| Marketplace Management  | Manage Amazon and Flipkart connections                       |
| Listing Management      | Assign, review and complete listing requests                 |
| Catalog Mapping         | Manage mapping requests and results                          |
| Ads Management          | Campaign tasks, budgets, optimization records                |
| Promotion Management    | Deals, coupons and promotional requests                      |
| Inventory Management    | Monitor stock and low-stock alerts                           |
| Label Management        | Process and share shipping labels                            |
| Report Management       | Upload, generate and publish monthly reports                 |
| Support Management      | Manage tickets and customer queries                          |
| Manager Management      | Assign managers and workload                                 |
| Documents               | Invoices, marketplace statements, client documents           |
| Activity Logs           | Track actions by employees and systems                       |
| Notifications           | Alerts, reminders and announcements                          |

### Roles (least privilege — never give everyone full admin)

| Role               | Permissions                         |
| ------------------ | ----------------------------------- |
| Super Admin        | Complete platform control           |
| Operations Manager | Client tasks and service operations |
| Listing Executive  | Listing and catalog mapping         |
| Ads Manager        | Advertising and promotions          |
| Support Executive  | Customer chat and tickets           |
| Accounts Executive | Payments, P&L and CA documents      |

## 6. Manager Workspace

Managers see **only their assigned customers** unless an admin grants broader access.

Functions: view assigned customers · see plan and limits · Manager Chat · receive/update tasks · upload reports and documents · process listing requests · process labels · track pending issues · internal notes · escalate marketplace issues · keep communication history. **Premium clients: call scheduling.**

## 7. Plans & Feature Access

**Source of truth:** `docs/plans/SOLLUNA_Marketplace_Management_Plans.txt` (published matrix + T&C). Plans: **Reseller ₹1,999 · Growth ₹4,999 · Premium ₹9,999**.

- 28 services, each mapped 1:1 to a feature key (`platform/packages/permissions/src/features.ts`) and a specialist skill (`.claude/skills/<skill>/`). `npm run verify:skills` fails on any drift.
- Permissions are enforced **in the backend**, never by hiding UI. Limits are **admin-editable** (`PlanFeature` table); code only seeds defaults.
- New listings: 3 / 25 / Unlimited — per marketplace, per billing month. Rejected/incomplete drafts don't count.
- Call support: — / On Request / Priority. Shipping labels + daily processing: Growth & Premium. Thank-you notes (personalized + custom design) and the 6 strategy services: Premium only.
- "Unlimited" = no numeric quota within fair use (T&C 12) — not instant or unlimited parallel work.

## 8. Customer Onboarding Pipeline

1. **Registration** – email/mobile authentication.
2. **Plan selection** – ₹1,999 / ₹4,999 / ₹9,999.
3. **Payment** – Razorpay.
4. **Business onboarding** – company name, GST, contacts, category, seller info.
5. **Marketplace details** – Amazon & Flipkart seller account info + authorization.
6. **Documents** – GST certificate, PAN, invoices, brand authorization, etc.
7. **Manager assignment** – assign an available manager.
8. **Account setup** – activate plan, configure permissions, create workspace.
9. **Service activation** – customer starts submitting requests.

## 9. Marketplace Integrations

- **Amazon:** official Selling Partner API (SP-API) — orders, inventory, catalog/listings, reports, finances, shipping/fulfillment where supported; Amazon Ads API for advertising. Docs: https://developer-docs.amazon.com/sp-api/
- **Flipkart:** official Seller API / authorized integrations — orders, listings, inventory, returns, reports, shipping, promotions where supported. Portal: https://seller.flipkart.com/

**Rule:** Confirm permissions, endpoint availability, account eligibility and authorization per workflow before building it. Use manual processing where no approved integration exists. **No production dependency on unauthorized scraping.**

## 10. Shipping Label & Thank You Note Pipeline

1. Fetch/receive eligible Amazon & Flipkart orders.
2. Identify orders needing labels.
3. Generate/retrieve official labels.
4. Premium: prepare personalized Thank You Note separately.
5. Combine into customer-specific print batches.
6. Check duplicates, cancellations, invalid orders.
7. Publish print-ready files to the customer dashboard.
8. Record processing time and delivery status.

| Plan   | Output                                        |
| ------ | --------------------------------------------- |
| ₹1,999 | No label generation                           |
| ₹4,999 | Official shipping labels                      |
| ₹9,999 | Official labels + personalized Thank You Note |

**Thank You Note template editor (Premium):** logo, brand name, approved message, brand colors, QR/website (only where marketplace-policy compliant), print dimensions, PDF output. **The official label is never modified** — the note is a separate parcel insert.

## 11. Product Listing Pipeline

**Customer submits:** name, brand, category, specs, images, MRP & selling price, HSN/GST, size/color/variations.

**Internal processing:** validation → product/competitor research → keyword research → title → bullets & description → attributes & category mapping → image QC → marketplace-specific prep → submission via authorized workflow → verification & status update.

**Statuses:** `SUBMITTED → UNDER_REVIEW → INFORMATION_REQUIRED → IN_PROGRESS → SUBMITTED_TO_MARKETPLACE → LIVE | REJECTED`

Amazon and Flipkart status are tracked **separately** for the same product.

## 12. Ads & Promotions (Growth + Premium)

Campaign creation · performance data · keyword/search-term analysis · bid optimization · budget monitoring · ACOS/ROAS · promo eligibility · deals & coupons · optimization history.

Every ad action logs: client, marketplace, campaign, previous setting, new setting, timestamp, actor (person or system). **Ad spend is billed separately from the subscription.**

## 13. Reporting & P&L

**Inputs:** sales reports, orders/returns, settlements, marketplace fees, ad spend, product purchase cost, other client expenses.

**Outputs:** gross sales · returns/cancellations · net sales · marketplace fees · ad spend · COGS · other expenses · estimated net profit · product-wise profitability · marketplace-wise profitability.

**Rule:** Never present verified profit from sales data alone — missing costs are flagged *unavailable* or *estimated*.

**Exports:** PDF report · Excel workbook · marketplace statements · CA documentation package.

## 14. Manager Chat & Support Tickets

**Manager Chat:** private 1:1 real-time chat, attachments (image/PDF/Excel/docs), history, read status, notifications, search, **internal notes visible only to SOLLUNA staff**.

**Ticket statuses:** `NEW → ASSIGNED → IN_PROGRESS → WAITING_FOR_CLIENT | WAITING_FOR_MARKETPLACE → RESOLVED → CLOSED`

**Categories:** account registration · brand approval · catalog mapping · new listing · ads · promotions · inventory · shipping labels · payments & settlements · account health.

Customers are notified automatically on every status change.

## 15. Database

PostgreSQL + Prisma. See `apps/api/prisma/schema.prisma`.

Core entities: users, organizations, subscriptions, plans, plan_features, marketplace_accounts, marketplace_credentials, products, listing_requests, catalog_mappings, ad_campaigns, promotion_requests, inventory_records, label_jobs, thank_you_templates, reports, ca_documents, conversations, messages, support_tickets, tasks, manager_assignments, payments, invoices, notifications, audit_logs.

**Multi-tenancy is non-negotiable:** every tenant record carries `organizationId`; no customer can ever read another's orders, credentials, reports, messages or documents.

## 16. Security

Secure auth · email/mobile verification · RBAC · org-level isolation · encrypted marketplace credentials · HTTPS everywhere · secure sessions · login rate limiting · 2FA for admins · audit logs for sensitive actions · upload validation + malware scanning · automatic backups · instant employee access revocation · data retention/deletion policy. **Never store marketplace passwords in plain text** — prefer OAuth + encrypted tokens.

## 17. Payments & Subscriptions (Razorpay)

`PLAN_SELECTED → PAYMENT_INITIATED → PAYMENT_VERIFIED → SUBSCRIPTION_ACTIVE → SERVICE_ENABLED`

Also: renewal reminders, failure notifications, grace period, upgrade, downgrade, cancellation, refunds, invoice generation, payment history.

**Rule:** Activate only on server-side signature verification + Razorpay webhook. Never trust the frontend success screen.

## 18. Notifications & Automation (Redis + BullMQ)

| Event                            | Automated Action           |
| -------------------------------- | -------------------------- |
| New customer registration        | Admin notification         |
| Successful payment               | Subscription activation    |
| New listing request              | Listing team notification  |
| New chat message                 | Manager notification       |
| Ticket status change             | Customer notification      |
| Low inventory                    | Customer and manager alert |
| New monthly report               | Customer notification      |
| Label batch completed            | Customer notification      |
| Subscription renewal approaching | Renewal reminder           |
| Failed marketplace connection    | Admin alert                |

Heavy work (label batches, report generation, syncs) runs in `apps/worker`, never inside a web request.

## 19. Development Roadmap

1. **Foundation** – repo, NestJS API, Next.js web, Tailwind, PostgreSQL + Prisma, dev/staging/prod.
2. **Public website** – home, about, services, pricing, contact, FAQ, legal, mobile-first.
3. **Auth & subscriptions** – register, login, recovery, Razorpay, activation, plan permissions.
4. **Customer dashboard** – overview, marketplace info, listing requests, documents/reports, chat, tickets.
5. **Admin & manager dashboards** – clients, roles, task allocation, requests, subscriptions, notes, audit logs.
6. **Core service ops** – catalog mapping, listings, labels, Thank You Notes, CA docs, reports/P&L.
7. **Marketplace integrations** – Amazon, Flipkart, order/inventory sync, ads data, reports, retries.
8. **Growth services** – ads, promotions, competitor monitoring, low stock, product research, pricing recs.
9. **Testing & security** – functional, permission, cross-tenant isolation, payments, API, performance.
10. **Launch** – domain, SSL, deploy, backups, monitoring, first client onboarding.

## 20. MVP Scope (launch with first 5–6 paying customers)

**Must work before first customer:** public site · 3 plans · register/login · Razorpay · customer, admin and manager dashboards · chat + tickets · listing & mapping requests · document upload/download · label processing · monthly reports/P&L · plan permissions · security + audit logs.

**After MVP:** full Amazon/Flipkart API sync · automated ads · automated competitor research · inventory forecasting · advanced product research · AI-assisted ops.

Staff process tasks manually via the admin panel first; automate each workflow only after customers prove they use it.

## 21. Repository Structure

```
platform/
├── apps/
│   ├── web/        Next.js + Tailwind (public site, customer portal, admin, manager)
│   ├── api/        NestJS modules: auth, users, organizations, subscriptions, marketplaces,
│   │               listings, catalog-mapping, advertising, inventory, shipping-labels,
│   │               reports, chat, support, payments, notifications, audit-logs; prisma/
│   └── worker/     BullMQ jobs, processors, schedules
├── packages/       shared, validation, permissions, types
├── docs/           architecture, api, database, workflows, testing
├── docker-compose.yml
└── package.json
```

## 22. Acceptance Tests (must pass before launch)

| Test                        | Expected Result                                                  |
| --------------------------- | ---------------------------------------------------------------- |
| Customer A logs in          | Only Customer A's data appears                                   |
| Customer B logs in          | Only Customer B's data appears                                   |
| ₹1,999 subscription         | 3 Amazon + 3 Flipkart new listings per billing month             |
| ₹4,999 subscription         | 25 Amazon + 25 Flipkart new listings per billing month           |
| ₹9,999 subscription         | Unlimited listings, subject to fair-use policy                   |
| Unauthorized feature access | Backend blocks the request                                       |
| Payment succeeds            | Subscription activates                                           |
| Payment fails               | Subscription stays inactive                                      |
| New support request         | Ticket appears in admin dashboard                                |
| Label processing completes  | Correct customer receives the files                              |
| Premium Thank You Note      | Correct brand design is generated                                |
| Monthly report uploaded     | Only the authorized customer can download it                     |
| Employee account disabled   | Employee immediately loses access                                |

## 23. Business Launch Strategy

- Start with 5–6 paying customers, one responsible manager each.
- Centralize listing, advertising and reporting workflows.
- Monitor workload and deadlines from the admin panel.
- Automate only after a workflow is proven.
- Track service cost and employee time per plan; review profit per customer monthly.
- **Never promise unlimited human labour** — define capacity and fair use in the service agreement.

## Build Order (summary)

1. Public website → 2. Customer/admin/manager dashboards → 3. Plans, payments, permissions → 4. Manual-assisted service workflows → 5. Amazon + Flipkart integrations → 6. Automation & intelligence → 7. Test with first customers, then scale.
