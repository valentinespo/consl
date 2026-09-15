# Reviewer notes — Shopify and Meta app reviews

Test company: **Consl Demo** on https://consl.ai (a fictional specialty-coffee brand with six
months of production, stock, orders and money already loaded). Reviewer login: reviews@consl.ai
with the password given in the submission form (no two-factor step, no email code).

## Shopify — how to test the "Consl" public app

1. Install the app on your development store (from the listing's Install button or the store's
   Apps page) and approve it on the consent screen. Authorization runs first, before any sign-in.
2. You land on consl's "Your store has authorized consl" page. Sign in with the reviewer login
   (or, if you were already signed in, click **Attach to Consl Demo**). The store attaches to the
   Consl Demo company.
   - The other way in: sign in first, then **Integrations** (left sidebar) → **Shopify** → enter
     your development store's `.myshopify.com` domain → **Connect** → approve on the consent screen.
3. Either way you land in consl on **Catalog → Map listings**, where the store's products are
   listed next to consl's products (exact matches are mapped automatically; the rest can be mapped
   from the picker).
4. What consl reads from the store, and where it shows:
   - **Products** (`read_products`) → Catalog → Map listings.
   - **Orders**, including orders older than 60 days (`read_orders`, `read_all_orders`) → Orders
     (every order with its items, source and where it shipped from) and P&L (revenue, taxes,
     processing fees, cost of goods per order).
   - **Inventory by location** (`read_inventory`, `read_locations`) → Facilities (each Shopify
     location becomes a facility with its stock) and Reorder (stock per place).
   - **Shopify Payments payouts** (`read_shopify_payments_*`) → P&L, "Pending" vs paid-out money.
5. Nothing is ever written to the store. consl only reads.
6. Uninstalling the app from the store, or clicking **Disconnect** in consl, stops all reads.
   What was already imported stays in the company's books (the company owner can delete the
   company from Settings, which removes everything).

GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) are registered at
https://consl.ai/api/integrations/shopify/compliance and are handled automatically.

## Meta — how to test the ads_read permission

1. Sign in at https://consl.ai with the reviewer login.
2. Go to **Integrations** → **Meta Ads** → **Connect**. Log in with your reviewer account (the app
   is Live; ads_read is the permission under review) and allow access.
3. Pick the ad account(s) to count. Their daily spend then appears on the **P&L** as an
   "Advertising" line under the sales channel it counts against (Amazon, Shopify or TikTok).
4. That is the only use of `ads_read`: daily spend totals per ad account, shown to the company
   that connected the account, in its own profit statement. No other Meta data is read or stored.
5. **Disconnect** removes the token immediately; **Disconnect and wipe** also deletes the spend.

## Screencast script (both reviews)

Sign in → Dashboard (inventory value, production lead time, reorder alerts) → Integrations →
Connect the platform → land on the mapping screen → Orders (open one order, show items and
"fulfilled at") → P&L (revenue, fees, ad spend, cost of goods, net profit) → Integrations →
Disconnect. Under two minutes.
