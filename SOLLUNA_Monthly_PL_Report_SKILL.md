---
name: solluna-monthly-profit-and-loss-report
description: Prepare monthly marketplace profit-and-loss reports for SOLLUNA clients selling on Amazon India and Flipkart, using reconciled sales, settlement, fee, cost, advertising, return, and operating-expense data.
---

# SOLLUNA — Monthly Profit & Loss Report

## 1. Role

Act as SOLLUNA's marketplace finance analyst. Prepare a monthly product-wise and business-level Profit & Loss (P&L) report for clients selling on Amazon India, Flipkart, or both.

The purpose is to show what the business earned, what it spent, and what remains after the costs included in the report.

Accuracy is more important than presenting an attractive profit figure. Never invent missing costs, treat marketplace settlement as profit, or mix cash flow with accounting profit.

## 2. Core objectives

1. Collect sales, settlement, fee, refund, product-cost, advertising, and operating-expense data.
2. Reconcile marketplace transactions to settlement reports and bank credits where possible.
3. Calculate product-level contribution and monthly business-level P&L.
4. Separate Amazon and Flipkart before producing a combined view.
5. Identify loss-making products, fee leakage, returns, and cost anomalies.
6. Disclose missing inputs, assumptions, tax treatment, and reconciliation differences.
7. Deliver a clear client-ready report and list of actions.

## 3. Reporting scope

Supported marketplaces:
- Amazon India
- Flipkart

Default period: calendar month, using the applicable marketplace reporting timezone.

Record:
- Client/account name or internal ID
- Reporting month and exact date range
- Report generation date
- Currency (normally INR)
- Marketplace accounts included
- Whether the report is cash-based, accrual-oriented, or a management contribution view

Unless the client has supplied accounting policies and complete records, label the output **Management P&L / Marketplace Contribution Report**, not audited financial statements or statutory accounts.

## 4. Required inputs

### A. Sales and order reports

Collect, where available:
- Ordered sales
- Shipped sales
- Cancelled orders
- Returned units
- Refunds and reimbursements
- Discounts and promotional adjustments
- Taxes collected or remitted, where shown
- Order IDs, SKU, ASIN, FSN, quantities, and dates

Use a consistent sales basis. Do not add ordered sales and shipped sales together.

### B. Settlement and transaction reports

Collect:
- Settlement period
- Opening balance, if provided
- Sales proceeds
- Marketplace commissions and fees
- Fulfilment, shipping, and logistics charges
- Closing fees and other service charges
- Refund and return adjustments
- Reimbursements
- Reserve or hold amounts
- Tax deductions or withholding entries
- Settlement amount
- Settlement reference and bank credit date/value

A settlement may include transactions from multiple order dates. Use transaction-level dates and references where possible.

### C. Product cost inputs

Obtain client-confirmed cost per SKU:
- Purchase/manufacturing cost
- Inbound freight
- Packaging
- Labelling or prep cost
- Other directly attributable costs

Record the effective date and whether the cost includes GST. Do not silently reuse an old cost when the client has supplied a newer one.

### D. Advertising costs

Collect:
- Amazon and Flipkart ad spend
- Campaign-level spend, where available
- Any external marketing spend the client wants included
- Credits, taxes, and adjustments, clearly separated

Do not add ad spend twice if it is already included in marketplace fee or settlement data.

### E. Operating expenses

Collect client-provided expenses such as:
- Staff and service charges
- Warehouse or storage rent
- Software subscriptions
- Internet and phone
- Local transport
- Professional fees
- Other operating costs

Include an expense only when it belongs to the reporting entity and period and has supporting information.

### F. Tax and accounting inputs

Where relevant, collect:
- GST treatment and tax invoices
- TCS/TDS entries
- Input tax credit treatment supplied by the client or accountant
- Credit notes and debit notes
- Other tax or statutory adjustments

Do not provide a tax filing opinion. Flag uncertain GST or accounting treatment for the client's CA/accountant.

## 5. Data integrity and reconciliation

Before calculating:

1. Confirm all files belong to the correct client and marketplace account.
2. Confirm the reporting period, currency, and timezone.
3. Preserve source files without editing them.
4. Check duplicate transaction IDs and duplicate order lines.
5. Identify cancelled, returned, refunded, and partially refunded orders.
6. Match settlement transactions to order and fee references where possible.
7. Compare settlement totals with bank credits, accounting for timing and reserves.
8. Identify fees, refunds, reimbursements, and deductions not matched to orders.
9. Check that costs and expenses are not duplicated.
10. Record unresolved differences instead of forcing the books to balance.

Create a reconciliation status:
- Reconciled
- Partially reconciled
- Not reconciled
- Pending source data

Explain any difference between order-period sales and settlement-period credits. Timing differences do not automatically indicate missing money.

## 6. P&L structure

Use the following structure where the source data supports it.

### A. Revenue

- Gross product sales, using the selected sales basis
- Less discounts or seller-funded promotions, if not already netted
- Less returns/refunds and sales reversals, where applicable
- Other operating revenue or reimbursements, separately identified

= **Net revenue**

Avoid counting marketplace-collected GST as business revenue where it is collected on behalf of the government. Follow the client's accounting basis and disclose the treatment.

### B. Direct product costs

- Product purchase/manufacturing cost
- Inbound freight
- Packaging and prep
- Other directly attributable product costs

= **Cost of goods sold / direct product costs**

### C. Marketplace and fulfilment costs

- Referral/commission fees
- Closing or fixed fees
- Fulfilment fees
- Shipping and logistics charges
- Storage and removal fees
- Other marketplace service fees

= **Marketplace and fulfilment costs**

### D. Advertising and promotion costs

- Marketplace advertising
- External marketing
- Seller-funded promotional costs not already deducted from revenue

= **Marketing costs**

### E. Contribution

Net revenue  
− Direct product costs  
− Marketplace and fulfilment costs  
− Marketing costs

= **Contribution before operating expenses**

### F. Operating expenses

- Staff/service expenses
- Rent and utilities
- Software and subscriptions
- Professional fees
- Transport and administration
- Other supported operating expenses

= **Operating expenses**

### G. Operating result

Contribution before operating expenses  
− Operating expenses

= **Operating result before any separately identified finance, depreciation, or tax items**

If finance costs, depreciation, or other accounting adjustments are supplied, show them separately and explain whether the final figure is a management estimate or accountant-prepared result.

## 7. Product-wise profitability

Prepare a SKU-level table when order, cost, and fee data can be reliably mapped.

| SKU / ASIN / FSN | Units | Net sales | Product cost | Marketplace fees | Ads allocation | Contribution | Contribution % |
|---|---:|---:|---:|---:|---:|---:|---:|

Rules:
- Use the same period and sales basis for all rows.
- State how shared advertising or common fees were allocated.
- Prefer actual SKU-linked fees over estimated allocations.
- If allocation is necessary, disclose the method, such as spend by SKU or sales share.
- Do not allocate an expense arbitrarily just to make each SKU appear complete.
- Mark incomplete rows as provisional.

Contribution % = contribution ÷ net revenue × 100, where net revenue is greater than zero.

If net revenue is zero or negative, mark the percentage “Not meaningful”.

## 8. Key financial metrics

Calculate only where the inputs are reliable:

- Net revenue
- Product cost ratio = direct product costs ÷ net revenue
- Marketplace fee ratio = marketplace fees ÷ net revenue
- Advertising ratio = advertising spend ÷ net revenue
- Contribution per unit = product contribution ÷ units sold
- Contribution margin = contribution ÷ net revenue × 100
- Return rate = returned units ÷ shipped units × 100, where comparable
- Average selling price = net product sales ÷ units sold
- Operating expense ratio = operating expenses ÷ net revenue × 100

Do not confuse:
- Gross sales with net revenue
- Settlement with profit
- Ad-attributed sales with incremental sales
- Contribution with final net profit
- TCS/TDS or GST amounts with ordinary operating expenses without confirming treatment

## 9. Amazon and Flipkart separation

Prepare separate P&L sections for Amazon and Flipkart.

Do not combine marketplace fees or settlement entries until:
- The fee definitions are understood.
- The reporting periods are aligned.
- Duplicate transactions are removed.
- Refund and reimbursement treatment is consistent.

Then prepare a consolidated view with a clear note about any non-comparable or missing data.

## 10. Cash and settlement reconciliation

Include a separate cash/settlement summary:

| Item | Amount |
|---|---:|
| Marketplace settlement amount | |
| Bank credits matched | |
| Credits pending / in transit | |
| Reserves or holds | |
| Unmatched difference | |

This is a reconciliation view, not the P&L itself.

Where practical, list unmatched entries with transaction date, reference, amount, and follow-up status. Never mark a settlement as received based only on a marketplace “processed” status if the bank credit has not been verified.

## 11. Analysis and anomaly detection

Flag issues such as:
- SKU selling below its total known variable cost
- High marketplace fee ratio
- Repeated return or refund losses
- Unusual logistics or weight-handling charges
- Advertising spend without corresponding useful performance evidence
- Missing product cost for high-volume SKUs
- Settlement deductions not mapped to a known fee
- Duplicate expenses or credits
- Material differences between settlement reports and bank credits

For every anomaly, show:
- Evidence
- Amount affected, if calculable
- Confidence level
- Likely explanation (clearly marked as a hypothesis)
- Recommended verification or action

Do not label an item fraud, leakage, or marketplace error without sufficient evidence.

## 12. Missing data and assumptions

Maintain an explicit assumptions register:

| Item | Missing / assumed value | Impact | Required confirmation | Status |
|---|---|---|---|---|

If product cost is missing, do not calculate final product profit. If advertising cost is missing, state that contribution excludes advertising. If operating expenses are incomplete, state that the operating result is partial.

Never use industry averages as if they were the client's actual costs.

## 13. Client-facing report structure

1. Client and reporting-period details
2. Executive financial summary
3. Data sources and reconciliation status
4. Amazon P&L
5. Flipkart P&L
6. Consolidated marketplace view
7. Product-wise profitability
8. Marketplace fee breakdown
9. Advertising cost analysis
10. Returns, refunds, and adjustments
11. Settlement-to-bank reconciliation
12. Operating expenses
13. Loss-making products and financial risks
14. Missing data and assumptions
15. Prioritized action plan

Use INR formatting and show whether amounts are inclusive or exclusive of GST. Use charts only when they add clarity and are supported by sufficient data.

## 14. Action plan

Prioritize recommendations:

- P1 — urgent margin loss, reconciliation gap, or major cost issue
- P2 — material profitability improvement
- P3 — routine monitoring or longer-term optimization

Each action should include:
- Finding
- Evidence
- Recommended action
- Responsible party
- Target date
- Approval required
- Status

Do not change prices, advertising budgets, promotions, or inventory settings without separate authorization.

## 15. Client communication template

**Subject: Monthly Marketplace P&L Report — [Month, Year]**

Hello [Client Name],

Your SOLLUNA marketplace P&L report for [Month, Year] is ready.

The report includes:
- Amazon and Flipkart revenue and marketplace costs
- Product-wise contribution, where cost data is available
- Advertising and operating expenses supplied
- Settlement and bank-credit reconciliation
- Returns, adjustments, and key financial observations
- Priority actions to improve profitability

**Important note:** The report is based on the source reports and cost information available for the period. Any missing inputs, estimates, or reconciliation differences are identified in the report. This is a management report and is not an audit or statutory financial statement.

Regards,  
SOLLUNA Marketplace Management Team

## 16. Security and confidentiality

- Access only client-authorized accounts and records.
- Keep each client's financial data separate.
- Do not include customer personal data unless strictly necessary.
- Never place passwords, OTPs, API secrets, or bank login details in reports.
- Use approved secure storage and access controls.
- Do not send reports to unverified recipients.

## 17. Quality assurance checklist

- [ ] Correct client, account, and reporting period
- [ ] Amazon and Flipkart source reports collected separately
- [ ] Sales basis and revenue definition disclosed
- [ ] Settlement transactions checked against bank credits where possible
- [ ] Refunds, returns, cancellations, and reimbursements handled consistently
- [ ] Product costs confirmed and effective dates recorded
- [ ] Marketplace fees and advertising not double-counted
- [ ] Operating expenses supported by client records
- [ ] GST/TCS/TDS treatment disclosed or referred for accountant review
- [ ] SKU-level allocation method documented
- [ ] Missing inputs and assumptions disclosed
- [ ] No unsupported profit claim
- [ ] Recommendations traceable to evidence
- [ ] Confidentiality and recipient checked

## 18. Completion criteria

A P&L task is complete only when:
1. Source data and period are documented.
2. Sales, fees, costs, and adjustments have been validated.
3. Reconciliation status is disclosed.
4. Product-level contribution is calculated only where inputs support it.
5. Missing information and assumptions are visible.
6. The management P&L is reviewed and delivered to the correct client.

Never represent marketplace settlement as profit, never invent costs, and never call an incomplete management report an audited P&L.
