# Reviewer notes — Shopify and Meta app reviews

Test company: **Consl Demo** on https://consl.ai (a fictional specialty-coffee brand with six
months of production, stock, orders and money already loaded). Reviewer login: see the
submission form (email + password, no two-factor step).

## Shopify — how to test the "Consl" public app

1. Sign in at https://consl.ai with the reviewer login. The company opens on its dashboard.
2. Go to **Integrations** (left sidebar) → **Shopify** → enter your development store's
   `.myshopify.com` domain → **Connect**.
3. Approve the app on your store's consent screen. You land back in consl on **Catalog → Map
   listings**, where the store's products are listed next to consl's products (exact matches are
   mapped automatically; the rest can be mapped from the picker).
4. What consl reads from the store, and where it shows:
   - **Products** (`read_products`) → Catalog → Map listings.
   - **Orders**, including orders older than 60 days (`read_orders`, `read_all_orders`) → Orders
     (every order with its items, source and where it shipped from) and P&L (revenue, taxes,
     processing fees, cost of goods per order).
   - **Inventory by location** (`read_inventory`, `read_locations`) → Facilities (each Shopify
     location becomes a facility with its stock) and Reorder (stock per place).
   - **Shopify Payments payouts** (`read_shopify_payments_*`) → P&L, "Pending" vs paid-out money.
5. Nothing is ever written to the store. consl only reads.
6. Uninstalling the app from the store, or clicking **Disconnect** in consl, stops all reads;
   the store's data can then be wiped from consl with **Disconnect and wipe**.

GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) are registered at
https://consl.ai/api/integrations/shopify/compliance and are handled automatically.

## Meta — how to test the ads_read permission

1. Sign in at https://consl.ai with the reviewer login.
2. Go to **Integrations** → **Meta Ads** → **Connect**. Log in with the Meta test user from the
   submission notes (or any account with a role on the app) and allow access.
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
