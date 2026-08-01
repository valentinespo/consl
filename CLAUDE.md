@AGENTS.md

# The app

> **Brand name: TBD.** The product is currently called **SellerOps** in the UI (the `<AppLogo>` wordmark and page copy). A final SaaS name is being chosen; when it lands, sweep the brand string, `package.json` name, the GitHub repo, and the Railway project in one pass. Until then, "the app" or "SellerOps" both refer to this product.

A multi-tenant **inventory, production & cost-accounting web app for ecommerce operators** — businesses that manufacture or assemble physical goods and sell them on Amazon (and, soon, Shopify + TikTok Shop). Its differentiator is **true landed cost per unit**: a FIFO costing engine that turns raw-material purchases and per-lot expenses into an accurate cost-of-goods for every finished unit, then layers restock/reorder recommendations and channel inventory on top. It began as an internal tool for one brand (Herbl) and is being generalized into a SaaS where each company is a tenant; **build every change tenant-agnostic** — no hardcoded product names, material codes, or brand assets.

## Stack & hard rules

- **Next.js 16 (App Router), React 19, TypeScript.** This Next is newer than your training data — **read `node_modules/next/dist/docs/` before writing framework code** (see AGENTS.md). Server Components + Server Actions are the default; client components are opt-in (`"use client"`).
- **Prisma 7** with the `prisma-client` generator (output `app/generated/prisma`) and the **PrismaPg driver adapter** (`@prisma/adapter-pg`) — not the plain PrismaClient. Postgres.
- **Clerk** for auth (`middleware.ts` = `clerkMiddleware`; public routes: sign-in, sign-up, join, welcome).
- **Tailwind v4** (`@tailwindcss/postcss`, `@theme` tokens in `app/globals.css`). Unlayered CSS in globals wins over utilities.
- **Phosphor icons** via `components/icons.tsx` — never drop a raw emoji into UI; add an icon there.
- PDFs: `pdfkit` (generate POs) + `pdf-parse` (read imported POs). Excel import: `exceljs`. File storage: `@aws-sdk/client-s3` (R2, optional) or the volume.

## Multi-tenancy (the backbone)

One shared database; **every business row carries `orgId`** and belongs to exactly one `Organization` (a tenant). Treat org-scoping as non-negotiable.

- `orgId` is `String?` in `schema.prisma` **on purpose** (so `lib/db.ts` auto-stamps it on create), but **NOT NULL at the DB level** (locked by migration `20260727000000`). When generating a new migration, `prisma migrate diff` will emit spurious `DROP NOT NULL` lines — **delete those hunks**.
- The tenant-scoped Prisma client (`lib/prisma.ts` / `lib/tenant.ts`) filters by the caller's org automatically. `lib/prisma-base.ts` is the **unscoped** client — use only for cross-tenant things (the Organization row itself, the sync-owner lookup).
- Access control: `lib/permissions.ts` defines `RESOURCES` (dashboard, inventory, lots, transactions, purchases, purchaseOrders, suppliers, facilities, catalog, settings, team) × actions (view/create/edit/delete/manage). Roles are `owner | member` (`lib/membership.ts`); members get per-resource permission grants. **Every page calls `requireView(resource)`; every server action calls `requirePermission(resource, action)`** before touching data.

## The costing engine (the heart)

`lib/fifo.ts` is a **pure, deterministic, no-IO** FIFO engine — keep it that way (it's the most test-critical code). Two cost sources per lot line:
1. **FIFO materials** — each material a lot consumes, costed oldest-stock-first from purchases. Pool keys: `FACILITY` (one pool per facility) or `FACILITY_SKU` (per facility+SKU).
2. **Transaction costs** — the "applicable" amounts of transactions assigned to the lot, bucketed by free-form **category** (see `lib/categories.ts`; a category either contributes to COG or is the reserved "Not applicable").

`lib/recompute.ts`: `computeEngineResult()` is read-only; `recomputeAll()` persists snapshots. **Server actions that change purchases, transactions, or lots must call `recomputeAll()`** then `revalidatePath("/", "layout")`. Regression anchors live in memory — a cost-total change is a red flag unless intended.

Downstream: `lib/restock.ts` + `lib/reorder.ts` (velocity model, months-of-cover, per-SKU window overrides → the Reorder page), `lib/finished-goods.ts` (finished-stock engine + `valueChannelStock`), `lib/sync.ts` + `lib/spapi.ts` (Amazon SP-API pull; interim workspace-key auth — see Integrations).

## The model (Prisma)

`Organization` → everything. Core chain: **`Purchase`** (raw materials bought, FIFO supply) → **`Lot`** (a production run at a `Facility`; `LotLine` per SKU, `LotMaterial` = its BOM) → finished goods. **`Transaction`** (allocation line of a `TransactionInvoice`) attaches per-lot expenses by category. **`PurchaseOrder`**/`PurchaseOrderLine` generate branded PO PDFs and open a lot. `Product` (SKU) & `MaterialType` = the catalog. `Supplier`, `Facility`, `StockMovement` (inter-facility/channel/loss moves), `Document` (uploaded invoices/COAs/BOLs). `SkuSnapshot`/`InventoryValueSnapshot` = time series. `Settings` = per-org config + dashboard layout.

## Facilities & channel integrations

A **Facility** is anywhere stock lives or is made (co-packer, warehouse, 3PL). **Connected sales platforms become LOCKED channel facilities** (Amazon → FBA + AWD; Shopify → SHOP; TikTok → TTS) — see `lib/integrations.ts`. Locked facilities are integration-owned: not editable/deletable in-app, hidden from vendor/lot/movement pickers (`getFacilities` etc. filter `channel: null`), shown in their own "Sales channels" section, and they hold finished channel stock (valued via `getChannelStock`). **The future per-tenant OAuth connect flow just calls `ensureChannelFacilities(provider)`** — everything downstream is already channel-aware. Today Amazon runs on workspace-wide SP-API env keys (one owner org may sync); real per-tenant OAuth is the next build.

## Design system

Efferd-inspired, one **violet** accent. Never hardcode a hex where a token exists (`app/globals.css`, theme-aware light/dark).
- **Accent**: `--color-accent` #7c3aed (dark #a78bfa), linked to the chart palette (`--color-chart` #8b5cf6). One schema — never a stray blue highlight.
- **Status pills**: the unified `.pill-green/amber/red/neutral/chart` classes only — the frosted recipe (translucent wash + faint same-hue border + hue text, token-driven) at **`font-medium` (500) weight everywhere**. Never ad-hoc tints, never semibold.
- **Donuts** (`components/Donut.tsx`): uniform rounded wedges, drop sub-3% slices from the wheel (keep them in the list), slim ring. Never re-add pills/nubs to tiny slices.
- **Exit animations**: `components/animate.tsx` (`useExitAnimation`, `ExpandRow`) + `dropdown-in/out`, `org-pop`/`org-pop-out` keyframes. Collapsibles/popups animate on close, not just open.
- **Server-action forms**: always clear `pending` in a `finally` (fixes the stuck-on-Saving hang). Attachments/edits **stage and commit on Save** — never auto-save a change.

## Deploy & verify

- **Branch `v2` → Railway staging** (project currently `herbl-ops-v2`, DB shared with local dev). `start` runs real migrations: `prisma migrate deploy && next start`. **After committing a completed change, `git push origin v2` to auto-deploy** — no need to ask.
- **Migrations are real and additive-only**: new tables / nullable columns; never drop/rename in a way that breaks a running deploy. Files in `prisma/migrations/`.
- **Local dev**: `.claude/launch.json` entry **"app"** (`cd App && npm run dev -- --port 3210`). `.env` `DATABASE_URL` points at staging, so local work and staging **share data** — verify reversibly, don't churn real rows.
- **Verify in-browser before claiming done** for anything the preview renders (see the harness's preview tools). Deploys are confirmed by watching the staging chunk-set fingerprint change.
- **Tenant files** (invoices, COAs, photos, PO logos) live on the Railway volume (`UPLOAD_DIR=/data`), served through `app/media/[...path]` with per-org ownership checks — **never commit tenant files into the repo**. The `legacy-uploads/` folder is gitignored (dev-only fallback).

## Conventions

- Match surrounding code; comment only real constraints, not narration. Money/qty formatting via `lib/format.ts` (2dp; `costFine` for sub-cent per-bag costs). Segment colors from `lib/segments.ts` (single source). Reference files as `path:line`.
- The `Herbl Inc.` org in staging is real live data for that brand (now just tenant #1). The old `ops.herbl.co` app is being retired — this staging DB is the real production going forward.
