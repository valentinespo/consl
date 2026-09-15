# Amazon SP-API developer profile — Solution Provider Portal "Data Access" form

Filled in 2026-09-15. Company: Bluesteam LLC (consl, consl.ai). Every security answer below is backed by
`docs/security-policy.md`, which was aligned with this form the same day.

## Organization type
Public Solution Provider (publicly available app, authorized by sellers via OAuth).

## Roles ticked (verified against Amazon's role mappings, 2026-09-15)
- Product Listing — Catalog Items API (only role that grants it) and Sellers getMarketplaceParticipations (NA: Product Listing or Selling Partner Insights).
- Amazon Fulfillment — FBA Inventory getInventorySummaries (Amazon Fulfillment or Product Listing; NOT Inventory and Order Tracking), Orders API, order reports; planned Fulfillment Inbound/Outbound reads.
- Finance and Accounting — Finances listTransactions (only role).
- Inventory and Order Tracking — Orders API + GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL (the natural role for the core product).
- Amazon Warehousing and Distribution — AWD listInventory / listInboundShipments (only role).

Not ticked: Pricing, Buyer Communication, Buyer Solicitation, Selling Partner Insights, Sustainability
Certification, Amazon Logistics, Brand Analytics, AISP, PISP, every Restricted role, and the
"Notifications in Seller Central" app integration.

Adding a role later means: update the developer profile (re-review), add the role to the app and
re-list it, then every seller must authorize again (new refresh token). So roles are requested up front.

## Security Controls (radio buttons)
All seven answered **Yes**: network controls; access restricted by job duty; encryption in transit;
incident response plan (defined roles, 6-month reviews, 24-hour notification); reporting to
security@amazon.com within 24 hours of detection; password rules (12+ chars with special characters,
MFA, 365-day expiration/annual rotation); credentials stored securely.

## Free-text answers

### Primary business activity (500 max — 461 chars)
consl (consl.ai, Bluesteam LLC) is a SaaS inventory, production and profit platform for brands that make physical goods and sell on Amazon, Shopify and TikTok Shop. Each seller authorizes consl via OAuth; we read its orders, FBA and AWD inventory levels, financial events and catalog details to run restock planning, landed-cost accounting per unit and a true profit statement inside its own account. Read-only towards Amazon, no buyer PII, no restricted roles.

### Use Cases (5000 max — 2942 chars)
consl (consl.ai) is a multi-tenant web application for ecommerce operators that manufacture or assemble physical products and sell them on Amazon, Shopify and TikTok Shop. A company connects its Amazon seller account through the Seller Central OAuth consent flow; consl then reads the data below on that company's behalf, stores it under that company's own tenant id and shows it only to that company's users. consl is read-only towards Amazon: it never creates or edits listings, prices, orders, shipments or inventory. It requests no restricted roles and never retrieves buyer names, addresses, emails or phone numbers.

Features by role:

Inventory and Order Tracking, Amazon Fulfillment
- Orders API (getOrders, getOrderItems, no buyer information): keeps each company's orders current so units sold, order status, fulfillment channel (FBA or merchant) and sales channel (Amazon or Multi-Channel Fulfillment) feed sales velocity, stock counts and the profit statement.
- Reports API, GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL: historical order backfill when a company first connects, so profit and velocity work from day one.
- FBA Inventory API (getInventorySummaries): fulfillable, inbound, reserved and unfulfillable units per SKU, driving restock recommendations (months of cover, when to produce or ship) and inventory valuation.
- Planned: Fulfillment Inbound API to show the status and expected arrival of FBA inbound shipments, and Fulfillment Outbound API to read the status of Multi-Channel Fulfillment orders placed for the company's other channels.

Amazon Warehousing and Distribution
- AWD API (listInventory, listInboundShipments): on-hand, reserved and inbound units per SKU in AWD, counted together with FBA so AWD-to-FBA replenishments are never double counted.

Finance and Accounting
- Finances API (listTransactions): settled financial events (item price, referral and FBA fees, refunds, promotions, advertising charges, storage fees, adjustments) that build the company's Amazon profit and loss statement and reconcile it to payouts.

Product Listing
- Catalog Items API (getCatalogItem, searchCatalogItems): read-only lookup of product title and image for the ASINs a company maps to its SKUs. Nothing is written.
- Sellers API (getMarketplaceParticipations): called once at connection time to learn the account's marketplaces, so consl uses the correct endpoint and marketplace id.

Data handling: all data comes directly from the Selling Partner API over HTTPS, is stored in consl's own database (Railway, United States), scoped per tenant, and used only to show that company its own inventory, restock and profit figures. Tokens are encrypted at rest; disconnecting Amazon deletes them; deleting a company purges its data. Amazon information is never sold, shared with outside parties, used for advertising or combined across sellers. consl will be listed in the Selling Partner Appstore once approved.

### Benefit to authorized users (500 max — 446 chars)
Sellers see in one place their live Amazon stock (FBA and AWD) next to stock at their own facilities, a restock plan that says when to produce or ship, the true landed cost of every unit they sell, and an Amazon profit statement built from their real fees and refunds. No spreadsheets, no manual report downloads, and no need to hand Seller Central access to staff or an agency: consl reads only what it needs and shows each company its own data.

### Outside parties (500 max — 487 chars)
None. consl does not sell, share or export Amazon Information to any outside party and never combines it across sellers. It is processed and stored only inside consl's own hosting environment: Railway (application hosting and database, United States). Cloudflare provides DNS and file storage for customer-uploaded documents only; Clerk handles user sign-in and holds no Amazon Information. These infrastructure providers act under their standard terms and have no right to use the data.

### External (non-Amazon) sources (500 max — 274 chars)
None. All Amazon Information is retrieved directly from the Selling Partner API using the OAuth authorization each seller grants through Seller Central. consl does not scrape Seller Central, buy Amazon data from third parties, or import Amazon reports from any other source.
