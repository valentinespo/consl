# Customer lifetime value

`/ltv` is in Finances. It uses Shopify customer IDs, with every order read from the connected
store's Admin API. Shopper names, email addresses and addresses are not requested. LTV settings
belong to the company and do not change P&L or inventory exclusions.

## Report

- Acquisition dates use the shared DateRangePicker (presets, custom range, Cancel and Apply),
  defaulting to the last 12 months. Presets resolve using the store’s current day.
- Cohorts: week (Monday start), month, quarter or year, in the Shopify store's timezone.
- Horizons: 30, 60, 90, 180, 365 and 730 elapsed days, plus a custom 1–3650-day horizon.
  The overview defaults to **Lifetime**, using all included purchases to date per customer.
  Selecting a day window shows the cumulative LTV for customers who reached that age.
- Metrics: sales per customer (LTV), sales, repeat purchase rate, orders per customer, AOV,
  orders and returning customers. Includes cumulative/per-period views and CSV. Cohort rows are
  read-only; they do not select or filter a comparison chart.
- The cohort heatmap and Lower–Higher legend share five distinct violet shades, scaled across
  the visible cohort cells. Missing/immature cells are uncolored. Text contrast follows the
  light/dark theme and the strength of the cell color.
- Revenue is collected payments after discounts and refunds, **including shipping and excluding
  tax**. The fixed basis is Shopify `netPaymentSet - currentTotalTaxSet`, floored at zero. This
  applies to LTV, AOV, the cohort table and CSV; there is no alternate revenue-basis selector.
  Refunds restate the original purchase and its earlier observation windows. Manual full refunds
  yield zero even if Shopify leaves the order tax lines unchanged. These are observed values.
- Paid, partially paid and refunded purchases count. Cancelled, voided, test and unpaid orders
  do not. Originally free orders ($0), including free samples, are always excluded from cohort
  acquisition, revenue, orders and repeat-purchase counts. There is no inclusion toggle. Fully
  refunded paid purchases keep their cohort membership. Samples with a nonzero order total
  need a confirmed tag or SKU convention; this report does not guess from product names.
- The Orders tab's `SalesOrder.voided` flag is authoritative for manual, bulk and rule-based
  voids. Voided orders are filtered before LTV date bounds, currencies or metrics are built.
  Voiding/unvoiding and void-rule changes invalidate `/ltv`; restoring an order includes it again
  if it otherwise qualifies. Shopify imports preserve the operator's void decision.
- Faire and TikTok default to excluded. The discovered originating app/channel IDs make the
  setting stable and group subscription first orders and renewals together. Explicit selections
  override the defaults, including allowing Faire/TikTok back in.
- Cohorts always start with the first included paid purchase. Excluded-channel orders have no
  effect on acquisition dates, maturity, customer/order counts, revenue, currency choices or
  date bounds. There is no cohort-start setting; legacy saved values are ignored.

Acquisition dates select **customers**, not orders. Their later purchases remain in the report.
Customers acquired before the selected range are not treated as new. A cell is blank until every
customer in that cohort has reached the horizon. Overall column summaries and overview KPIs use
all customers who individually reached that age, weighted by customer count. Regrouping rows
therefore never changes the overall values. Missing customer IDs are counted and excluded, never
merged into a guest customer. Currency changes are handled as separate selectable currencies.

Profit LTV, CAC/payback, ad attribution, product segmentation and predictive LTV are not part of
this implementation. They require additional cost/attribution definitions beyond revenue LTV.

## Data and deployment

Apply `20260921120000_customer_ltv` before running the new code. It only adds columns to Settings
and SalesOrder. `20260922013000_ltv_live_updates` adds the index used for live change checks.
The existing start command applies migrations before starting Next.js.

The scheduler checks Shopify's **granted** scopes and refreshes the stored scope list. It needs
`read_customers` and `read_all_orders`; it does not change either app's requested scopes. The
public app without approved access shows an access message. The custom app can use its existing
grants. Protected-customer-data API errors leave preparation incomplete and explain the missing
access. Checks retry automatically; there are no manual start, continue or retry controls.

`shopifyLtvState` stores the shop, snapshot cutoff, cursor, imported count and completion/error.
Five bounded pages are processed per step on a dedicated minute loop, independent of slower
stock, ads and Amazon import jobs. The first check starts shortly after server startup; no page
visit is needed. The cursor advances only after all orders and finance rows have been persisted.
An expiring database lease prevents simultaneous history workers.
The report stays hidden until every page completes, so partial history cannot create false
acquisition cohorts. Automatic retries resume from the last successful page. Switching shops resets the
history state and filters out facts from the old store.

LTV uses the same SalesOrder records as Orders. The initial history check updates those records
with newly needed payment/refund, original-total, test-order and stable channel identity fields;
it also checks that older first purchases were not missed by the previous capped order pull.
The unique shop order key prevents duplicates. Once the history check completes, it does not
repeat on visits or server restarts; live order updates keep the stored facts current.

Live order/refund webhooks and the existing updated-at reconciliation keep `SalesOrder.ltvData`
fresh. Scalar payment and tax totals avoid line-item and shipping/refund pagination limits.
Facts and import state are versioned: the revenue-definition change restarts history enrichment
and does not treat the old merchandise-only facts as current. The order page size stays below
Shopify's query-cost limit.

An open, visible LTV page checks for changes every five seconds, including after history import
finishes. It checks again immediately on focus, returning to the tab or regaining connectivity.
The authenticated, tenant-scoped endpoint returns only an opaque revision and uses an indexed
latest-order lookup. Orders, refunds, cancellations, void/unvoid, channel settings and import
progress automatically refresh the report; current filters, scroll and open settings drafts are
preserved. Failed checks retry without clearing the report. Hidden/offline tabs catch up when
active again. A minute tick also advances age-dependent cells and date presets without an order
change, and bounds recovery from timestamp ties or out-of-order transaction commits. This is
automatic polling after Shopify data reaches Consl, not a guarantee of instant Shopify delivery.

Views require `dashboard:view`; changing LTV settings requires `settings:edit`. History preparation
runs automatically for active companies with syncing enabled. Database reads and writes use the tenant-scoped Prisma client. The browser gets
aggregated cohort statistics, never customer IDs or raw order payloads.

## Validation

`npm run test:ltv` exercises acquisition-range boundaries, channel exclusions, subscription
identity, refunds, tax-inclusive shipping/refunds, unknown customers, maturity, weighted
summaries, repeat-customer deduplication, period boundaries, timezone and currency handling.

The additive migration and browser interactions were checked in an isolated in-memory Postgres
database, with synthetic cohorts and a separate Shopify import validation tenant. The source
database was read only. Shopify operations were validated against its schema and exercised
against the connected custom app.

Live refresh was verified by changing a synthetic order in the isolated database while leaving
the LTV page open: voiding removed its customer, restoring it brought the customer back, and a
refund reduced the displayed values without navigation or manual reload. Date/grouping filters
and an unsaved channel-selection draft survived each update. The synthetic order was restored
afterward. The LTV tests, focused lint and production build pass.

## References

- [Lifetimely LTV Cohort Report](https://help.useamp.com/article/1124-ltv-cohort-report-overview)
- [Triple Whale Customer Cohorts](https://kb.triplewhale.com/en/articles/5725663-customer-cohorts)
- [Shopify Order fields](https://shopify.dev/docs/api/admin-graphql/2026-01/objects/Order)

The reference products expose different revenue definitions. Consl labels its basis explicitly;
it does not claim that a differently configured report will reconcile to either vendor by default.
