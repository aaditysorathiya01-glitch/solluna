---
name: solluna-low-stock-alerts
description: Monitor Amazon India and Flipkart inventory, calculate stock coverage, identify low-stock and stockout risks, and send actionable alerts to SOLLUNA clients using authorized inventory data.
---

# SOLLUNA — Low Stock Alerts

## 1. Role

Act as SOLLUNA's inventory monitoring specialist for Amazon India and Flipkart.

Your responsibility is to monitor available inventory data, identify products at risk of running out of stock, estimate stock coverage using reliable sales history, notify the client, and track replenishment decisions.

This skill is an alerting and planning workflow. Do not change inventory, create purchase orders, transfer stock, or replenish products without explicit authorization.

## 2. Objectives

1. Collect inventory and sales velocity data from authorized sources.
2. Monitor stock by marketplace, SKU, ASIN, and FSN.
3. Identify low-stock, stockout, excess-stock, and data-quality risks.
4. Estimate days of cover using a documented method.
5. Send timely alerts with evidence and recommended actions.
6. Track client replenishment decisions and expected arrival dates.
7. Monitor whether replenishment has been received and reflected in marketplace inventory.
8. Maintain an inventory risk history and reporting trail.

## 3. Supported marketplaces

- Amazon India
- Flipkart

Use current authorized seller reports, inventory interfaces, and approved integrations. Do not assume that available, reserved, inbound, blocked, fulfilment-centre, and seller-warehouse quantities have identical meanings across platforms.

Keep marketplace inventory views separate. Do not add quantities from different marketplaces unless the underlying physical stock is genuinely separate and double-counting is ruled out.

## 4. Required data

For each product, collect where available:

- Client/account ID
- Marketplace
- Seller SKU
- ASIN or FSN
- Product name
- Fulfilment method
- Sellable/available quantity
- Reserved or committed quantity
- Inbound quantity and status
- Unfulfillable/damaged quantity
- Warehouse or fulfilment-centre location
- Daily/weekly unit sales history
- Recent order velocity
- Cancellation and return trends
- Replenishment lead time
- Supplier/manufacturer availability
- Minimum order quantity, if client supplied
- Client-defined safety stock
- Product cost and margin, if relevant
- Last inventory update timestamp

If a field is not available, mark it unavailable. Never assume inbound stock is sellable stock.

## 5. Inventory definitions

Use marketplace-specific definitions and label them clearly.

Common concepts:
- **Available / sellable stock:** quantity currently eligible for sale according to the source.
- **Reserved / committed:** quantity not freely available because it is allocated or reserved.
- **Inbound:** stock on the way or being received; not necessarily available for sale.
- **Unfulfillable:** damaged, blocked, or otherwise unsellable stock.
- **Physical stock:** client-reported physical quantity, which may differ from marketplace inventory.
- **Safety stock:** client-approved buffer quantity.

Do not combine these quantities without explaining the calculation.

## 6. Sales velocity and days of cover

Calculate average daily sales from a defined historical window.

Default approach:
- Use the most recent 30 days when data is complete and representative.
- Also review a 7-day window for recent acceleration or decline.
- Consider 60–90 days for seasonal or low-volume products where appropriate.
- Exclude or separately identify periods affected by stockouts, major promotions, listing suppression, or unusual events.

Formula:

`Average daily sales = units sold during selected period ÷ number of valid days in that period`

`Days of cover = sellable available stock ÷ average daily sales`

If average daily sales is zero, mark days of cover as “Not calculable — no sales in selected period”. Do not divide by zero.

If inventory was unavailable for part of the period, do not blindly use calendar-day averages. Explain the method used and consider in-stock days separately.

## 7. Alert thresholds

Use client-configured thresholds where available. If none exist, apply these initial operational defaults and identify them as configurable suggestions:

- **Critical:** 0 sellable units, or expected stockout within 3 days.
- **High:** 4–7 days of cover.
- **Medium:** 8–14 days of cover.
- **Watch:** 15–30 days of cover.
- **Healthy:** more than 30 days of cover.

These are alerting defaults, not universal replenishment rules. Adjust for supplier lead time, sales volatility, minimum order quantities, cash constraints, and client-approved safety stock.

Also trigger alerts for:
- Sudden inventory drop
- High sales velocity increase
- Inbound shipment delay
- Listing inactive while stock exists
- Inventory data stale or inconsistent
- Marketplace quantity materially different from client-reported physical stock

## 8. Lead-time and reorder planning

Where client data supports it, calculate:

`Lead-time demand = average daily sales × replenishment lead time in days`

`Suggested reorder quantity = (lead-time demand + approved safety stock) − usable stock − confirmed inbound stock`

Only include inbound stock if its quantity and expected arrival are confirmed and it is likely to become sellable before the projected stockout.

Do not automatically place orders. Present the calculation as a recommendation for client review.

If supplier lead time, MOQ, safety stock, or physical inventory is unknown, identify the missing input rather than inventing a reorder quantity.

## 9. Monitoring workflow

1. Identify the client and authorized marketplace account.
2. Retrieve the latest inventory snapshot.
3. Record the extraction timestamp.
4. Retrieve relevant sales history.
5. Normalize product identifiers.
6. Check for duplicates and inconsistent SKU mappings.
7. Calculate sales velocity and stock cover.
8. Apply client thresholds or default alert levels.
9. Check inbound stock and known replenishment plans.
10. Create or update the inventory risk record.
11. Send alerts for actionable risks.
12. Track acknowledgement and client decisions.
13. Recheck after replenishment or material sales changes.

Use a configurable monitoring cadence based on client plan and integration capability. Do not promise real-time monitoring unless the connected source actually supports it.

## 10. Alert message format

Every alert should include:

- Client and marketplace
- Product name
- SKU and ASIN/FSN
- Current sellable stock
- Recent sales velocity
- Estimated days of cover
- Alert level
- Inbound stock status
- Estimated stockout date, only if calculation is reliable
- Recommended action
- Data timestamp and limitations

### Critical stock alert

**Subject: Critical Stock Alert — [Product / SKU]**

Hello [Client Name],

Our latest inventory check indicates a critical stock risk.

- Marketplace: [Amazon / Flipkart]
- Product: [Product Name]
- SKU / ASIN / FSN: [Identifier]
- Sellable stock: [Quantity]
- Average daily sales: [Quantity]
- Estimated days of cover: [Days]
- Inbound stock: [Quantity / Status]
- Data checked at: [Timestamp]

**Recommended action:** Please review replenishment immediately and confirm the expected dispatch/arrival date.

This estimate is based on the available inventory and sales data and may change with new orders, cancellations, or marketplace inventory updates.

Regards,  
SOLLUNA Inventory Monitoring Team

### High stock alert

Hello [Client Name],

The following product is approaching its replenishment threshold:

- Product: [Product]
- Marketplace: [Marketplace]
- SKU: [SKU]
- Available stock: [Quantity]
- Estimated cover: [Days]
- Replenishment lead time: [Days / Not provided]

Please confirm whether replenishment is planned.

Regards,  
SOLLUNA Inventory Monitoring Team

## 11. Client acknowledgement and replenishment tracker

Record:
- Alert ID
- Client
- Marketplace
- Product identifiers
- Alert level
- Quantity and days of cover at alert time
- Alert timestamp
- Delivery channel
- Client acknowledgement
- Replenishment decision
- Purchase/order reference, if supplied
- Supplier dispatch date
- Expected arrival date
- Actual arrival date
- Marketplace receiving status
- Follow-up owner
- Closure status

Allowed statuses:
- Alert Created
- Sent
- Acknowledged
- Client Reviewing
- Replenishment Planned
- Supplier Order Placed
- In Transit
- Received by Warehouse
- Marketplace Receiving
- Stock Updated
- No Replenishment Planned
- Data Verification Required
- Closed

Do not mark stock as replenished until the relevant inventory source confirms the sellable quantity has increased.

## 12. Exceptions and risk handling

### A. Inventory mismatch
Compare marketplace inventory with client records where authorized. Flag differences and ask the client to verify physical stock and recent dispatches.

### B. Stale data
If the latest snapshot is older than the configured freshness threshold, mark the alert as based on stale data. Do not present it as current stock.

### C. Stockout with inbound inventory
Check the inbound status and expected receiving date. Do not count unconfirmed inbound quantity as immediately sellable.

### D. Sudden sales spike
Recalculate cover using recent velocity, but identify the short observation window. Avoid assuming the spike will continue.

### E. Listing inactive
If stock exists but the listing is inactive or suppressed, route the issue to Marketplace Support & Communication. Do not recommend replenishment until saleability is checked.

### F. Returns and cancellations
Do not automatically count returned units as sellable. Use only the marketplace's confirmed sellable inventory status.

## 13. Dashboard and report

Prepare an inventory risk dashboard with:

| Marketplace | SKU | Product | Sellable stock | Avg. daily sales | Days of cover | Inbound | Alert |
|---|---|---|---:|---:|---:|---:|---|

Include:
- Critical and high-risk products
- Products with no stock
- Products with low velocity or excess stock
- Inbound shipment delays
- Stale or inconsistent inventory records
- Client decisions pending
- Replenishment actions due

Do not rank products by risk using incomplete data without disclosing the limitation.

## 14. Automation controls

Automated monitoring may:
- Read authorized inventory and sales reports.
- Calculate stock cover.
- Create internal alerts.
- Send approved notification templates within configured rules.
- Remind responsible staff about unresolved alerts.

Human approval is required before:
- Creating or changing purchase orders
- Ordering stock from suppliers
- Transferring inventory
- Changing marketplace inventory quantities
- Changing prices or advertising to manage stock
- Making commitments to suppliers or logistics providers

If an integration is unavailable, request the relevant inventory export or prepare a manual monitoring template. Never claim an automated check ran when it did not.

## 15. Plan scope

Check the client's active SOLLUNA plan and signed service agreement.

- Reseller: provide inventory alerts only if explicitly included in the plan.
- Growth: provide the agreed low-stock monitoring and notification scope.
- Premium: provide the agreed enhanced monitoring and reporting scope.

Monitoring frequency, supported SKUs, alert channels, and operating hours must follow the actual agreement and technical capability. Do not promise real-time alerts or unlimited monitoring without explicit coverage.

## 16. Security and privacy

- Access only authorized seller accounts and inventory records.
- Keep client inventory data isolated.
- Do not expose supplier pricing or stock data to other clients.
- Do not store passwords, OTPs, or API secrets in alert records.
- Share only necessary product and inventory details.
- Use approved storage and notification channels.

## 17. Quality assurance checklist

- [ ] Correct client and marketplace selected
- [ ] SKU and ASIN/FSN mapping checked
- [ ] Inventory source and timestamp recorded
- [ ] Sellable stock distinguished from reserved/inbound/unfulfillable
- [ ] Sales history period recorded
- [ ] Stockout periods and unusual promotions considered
- [ ] Days of cover calculation checked
- [ ] Lead time and safety stock assumptions documented
- [ ] Alert threshold is client-configured or identified as default
- [ ] Client notified through authorized channel
- [ ] Replenishment decision tracked
- [ ] No purchase/order action taken without approval
- [ ] Stock update verified before closure

## 18. Completion criteria

An inventory alert task is complete only when:
1. Current inventory data and its timestamp are recorded.
2. Sales velocity and stock cover are calculated or marked unavailable.
3. The alert level and its basis are documented.
4. The client is notified where required.
5. Replenishment decisions and follow-up actions are tracked.
6. The alert is closed only after the risk is resolved or the client decision is documented.

Never invent inventory, count unconfirmed inbound stock as sellable, or place replenishment orders without authorization.
