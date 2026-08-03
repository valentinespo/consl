# Single-Count Inventory Plan (final, attack-hardened)

The definitive design for eliminating double-counted inventory between consl's own ledger and
Amazon's reported stock, plus the estimated-cost and payment layers. Produced 2026-08-03 from a
15-agent design workflow (6 subsystem readers → 3 independent designs → merge → 5 adversarial
reviewers); all blocker/major findings are integrated below. Implement phases in order; each is
independently shippable.

## 0. Core principles (the three axes)

- **PHYSICAL** (where units are) — movements + Amazon's own shipment records. Drives unit counts.
- **COST** (do we know true COGS) — estimate invoices that true up. Drives valuation.
- **PAYMENT** (has money moved) — due dates/payments on invoices. Drives payables ONLY; the engine
  never reads payment fields, by construction.

Every physical unit sits in exactly one bucket at every instant. Amazon-reported units are
authoritative for FBA/AWD; the app's pools are authoritative for everything else. The bridge is
**Amazon's real inbound-shipment records**, not user discipline.

**Rejected (do not revisit without new evidence):** new LotStatus values (SHIPPED etc.); stored
Lot.costingStatus; per-line estimate flags (lines are delete-and-recreated on edit); excluding
estimates from COG; payment touching COG; aggregate inbound-netting heuristics; linking shipments
to LOTS (pool-FIFO is lot-agnostic — they link to MOVEMENTS); modeling AWD→FBA replenishment;
fake backfill lots/layers for day-one stock; restating InventoryValueSnapshot history; silently
auto-finishing lots; LOSS movements for receiving discrepancies (units already left the pool).

## 1. Data model (all additive)

**Migration A (cost + payment + valuation):**
- `TransactionInvoice.isEstimate Boolean @default(false)` — header-level (survives line rewrites).
- `TransactionInvoice.dueDate DateTime?`, `paidAt DateTime?`, `amountPaid Float?` — display-only.
  Semantics: `dueDate` = balance due date; `amountPaid` = running total; `paidAt` set only when
  `amountPaid >= invoiceTotal`; overdue = `now > dueDate && amountPaid < invoiceTotal`.
- `Product.standardUnitCost Float?` — day-one channel-valuation fallback (org home currency).
- New `CostRevision { id, orgId, invoiceId, lotId?, oldTotal, newTotal, at }` — audit of estimate
  true-ups; the replace-flow shows "X units still in inventory reprice by $A; Y already sold —
  $B will not appear in inventory value."
- `InventoryValueSnapshot.provisionalValue Float @default(0)` — share of that day's total held at
  estimate-sourced cost, so chart steps self-explain. Never restate history.

**Migration B (shipment mirror):**
- `InboundShipment { id, orgId, platform('amazon'), channel('FBA'|'AWD'), externalId,
  confirmationId?, name?, extStatus, marketplaceId?, origin('SELLER'|'AMAZON'), extCreatedAt,
  extUpdatedAt, historical Bool, ignored Bool, lastSyncedAt }` `@@unique([orgId, platform,
  externalId])`. Rows never deleted; mirror never stops upserting a row because it left the query
  window.
- `InboundShipmentLine { id, shipmentId FK Cascade, sellerSku, productId?, qtyShipped,
  qtyReceived? }` — re-upserted each sync; **nothing may FK a line**.
- `MovementShipmentLink { id, movementId FK, shipmentId FK, qty }` — many-to-many with allocated
  qty (one movement may cover three tranches; two movements may cover one shipment).
- `StockMovement.source String @default("MANUAL")` (`MANUAL|AUTO`).
- `Integration.reconcileSince DateTime?`, `shipmentsSyncedThrough DateTime?` (high-water mark =
  max persisted extUpdatedAt − lag buffer; the delta query uses THIS, never lastSync, so outages
  longer than any fixed window cannot lose shipments), `shipmentSyncStatus String?`.

**Explicitly unchanged:** LotStatus (2-value enum), Lot columns, lib/fifo.ts, lib/finished-goods.ts
(stays pure — synthetic movements are just data), lib/recompute.ts.

## 2. PHYSICAL axis

### 2a. Shipment mirror (lib/spapi.ts + lib/sync.ts)
- FBA: v0 `getShipments` (catch-all + only source of received qty; isolated in one function) +
  items; enriched from v2024-03-20 `getShipment` (join on confirmationId). AWD:
  `listInboundShipments` + `getInboundShipment?skuQuantities=SHOW`, strictly serialized ≥1.1s.
  Both paged to exhaustion via NextToken through a backoff-wrapped `sp()` (429 retry).
- **Origin classification:** mark `origin='AMAZON'` + `ignored=true` for any FBA shipment whose
  source is not a seller facility (v2024 source / v0 ShipFromAddress; cross-check AWD
  `listReplenishmentOrders`). AWD→FBA replenishment must NEVER generate virtual movements.
- **Marketplace guard:** stamp destination marketplace; only shipments matching the org's synced
  marketplace generate virtual movements; others get a visible "other-marketplace excluded" chip.
  v1 constraint: one marketplace per org (documented).
- Failure isolation + health: shipment-pull failure never fails the inventory snapshot and never
  marks the Integration errored; it sets `shipmentSyncStatus`. When stale > one sync interval,
  Reorder/Inventory/Dashboard show a degraded-mode banner ("shipment reconciliation unavailable
  since X") and awaiting-handoff chips soften their claim. FBA 403/404 tolerated like AWD.
- Concurrency: per-org sync lock/debounce (skip-if-running, trailing re-run). Post-write syncs are
  snapshot-only and best-effort (never surface as Integration errors).
- Historical rule is **STATUS-based at first mirror**: historical iff extStatus is terminal
  (CLOSED/CANCELLED/DELETED/VOIDED/ABANDONED) at first sync. Open shipments (e.g. batch 18's live
  AWD shipment) are live regardless of extCreatedAt. `reconcileSince` only bounds query lookback.

### 2b. Virtual handoff movements — the correctness core (new lib/handoff.ts)
Consumed in lockstep by BOTH builders (lib/restock.ts getRestock AND lib/queries.ts
computeFinishedGoods) — they must never diverge.

- **Which shipments count:** every mirrored, non-historical, non-ignored, seller-origin,
  synced-marketplace shipment in any status EXCEPT CANCELLED/DELETED/VOIDED/ABANDONED —
  **including CLOSED, forever**. A virtual drain is permanent like a real movement; only linked
  real movements suppress it. (Per-API status maps enumerated in code + unit test per enum value.)
- **Netting (structural, matcher-independent):** per SKU,
  `virtualQty = max(0, Σ qtyShipped(counting lines) − Σ linked qty − Σ UNLINKED
  toDestination=AMAZON movement qty within extCreatedAt ± 30d)`, then attributed per shipment.
  Double-drain is impossible even when the matcher misses; ambiguity degrades to correct totals
  with fuzzy attribution + a "probable match" alert. Epsilon: qty ≤ 1e-6 is zero.
- **Adoption-era guard (added during Phase 5, verified against Herbl's real data):** the ±30d
  window assumed extCreatedAt is the true creation date, but FBA's v0 API reports none — every
  backfilled shipment's effective date is first-seen, months away from the operator's hand-recorded
  movements (Herbl: live tranches eff-dated Aug 3 vs covering movements dated Apr 10/29). So
  shipments first seen within 48h of `reconcileSince` (the initial backfill) ALSO net against
  unlinked AMAZON movements dated before reconcileSince: mid-flight shipments discovered on day one
  were inevitably already recorded under the operator's old bookkeeping dates. The pre-era lump can
  never touch shipments first seen later, so it is a one-time reconciliation, not a leak. Over-netting
  degrades to the status quo (no drain); under-netting would double-drain — generosity is the safe
  direction.
- **Pre-receipt lag cap:** until qtyReceived>0 or status ≥ RECEIVING, cap per-SKU virtual qty at
  the snapshot-reported inbound for that channel (min with fbaInbound/awdInbound) — closes both
  directions of cross-endpoint lag. After receiving starts, basis is qtyShipped.
- **Facility resolution (virtual drains carry no facility):** global FIFO across every pool
  holding the SKU, oldest layer first (stable facility tiebreak); remainder deducts from
  IN_PRODUCTION lot lines oldest-first (poDate), valued at current cogPerUnit, floored at zero.
  Facility attribution from virtual drains is labeled *inferred*.
- **Replay ordering:** engine consumption date = max(extCreatedAt, latest supply date for the
  SKU) so late-backfilled lots still get drained; ShippedLayer.date stays extCreatedAt (valuation
  order). Synthetic movements get a deterministic seq after real movements on the same date,
  keyed by externalId — identical in both builders.
- **Valuation continuity:** units deducted from in-production emit a synthetic shipped layer
  priced from the deducted lines' cogPerUnit, so channel value moves with the units (no fb-repricing
  jump).
- **Display:** deducted in-production units render as an "Awaiting handoff" chip (units + shipment)
  on Reorder rows and the Inventory in-production table; excluded from grandTotal and from
  computeReorder's production bucket (Amazon's bucket already carries them). Day-one org: empty
  pools → pure shortfall → zero deduction; cannot go negative, cannot vanish units.

### 2c. Matcher + linking (attribution, not correctness)
Auto-link exact matches at sync (SKU, qty ≈, date ± 7d, both unlinked, non-terminal shipment);
links live in MovementShipmentLink with qty. MovementForm preselects a matching open shipment when
target=AMAZON. Cancelled-shipment-with-linked-movements → alert + one-click reversal (delete/unlink
movements, restoring the pool); terminal shipments excluded from matcher candidates. Deleting an
AUTO movement stamps its shipment so auto-materialization never recreates it.

### 2d. Actions & surfaces
- **Shipments panel** (Facilities page, next to Sales channels; new `shipments` resource in
  lib/permissions.ts): name/id, channel, Amazon status, shipped vs received per SKU, link state;
  actions: Record in ledger / Link to movement / Ignore. CLOSED with qtyReceived<qtyShipped →
  informational discrepancy chip + reimbursement nudge (never a LOSS movement). "Shipped exceeds
  recorded production by N" chip when residual shortfall exceeds all remaining supply (bad lot
  edit signal). Unmappable SKUs surfaced, never dropped.
- **The batch-18 card** — `recordShipmentHandoff(shipmentId, facilitySplits[], alsoFinishLotIds[],
  estimateAmount?)`: one $transaction that finishes the named IN_PRODUCTION lots (finishedAt =
  today), optionally creates a bundled estimate invoice, dry-runs pool coverage (never materializes
  a shortfall movement from the happy path — writes covered qty, leaves remainder virtual), creates
  linked movements dated extCreatedAt, then recomputeAll + best-effort snapshot sync. Surfaced as
  Dashboard alert, Reorder stacked action, panel Resolve.
- **Reorder Ship button:** "Ship units (from X)" becomes a real button opening MovementForm
  prefilled (SKU, qty, source facility, AMAZON, matching shipment preselected).
- **Stock-take primitive** (bounds drift for non-Amazon sinks): a facility count flow that creates
  a prefilled correction movement (LOSS/CUSTOMER), plus staleness nudges ("900 units at WH1
  untouched 90d — count and adjust?") in lib/alerts.ts.
- **Receive from Amazon** (phase 7, but schema must leave room): removal orders return real units
  to a facility; an inbound-from-channel movement (StockMovement.fromDestination or a "Receive
  from Amazon" action) re-adds a pool layer valued by drawing back newest shipped layers.

## 3. COST axis

- `isEstimate` toggle on invoices; estimates hit COG identically to confirmed (engine untouched);
  amber "est." pill. "Replace with final invoice" edits amounts + clears flag + recomputeAll and
  logs a CostRevision (with the sold-units disclosure). "Mark estimate as final" (accepts as-is).
  Stale-provisional alert with per-invoice dismiss.
- **Derived provisional badge** (never stored): lot is provisional iff any attached line belongs
  to an isEstimate invoice OR its PO has TBD lines. Shows in LotEditor, LotsTable, Dashboard
  footnote, tinted cost chips.
- **Deposit/estimate coexistence guard (blocker fix):** adding a non-estimate invoice to a lot
  with an open estimate prompts: (a) "payment on the estimate" → records amountPaid, no COG
  lines; (b) "partial cost" → reduces the estimate's lines by the same amount atomically. Warning
  chip when estimate + real invoices overlap categories on one lot.
- **Finish-flow prompt:** flipping FINISHED on a cost-incomplete lot offers a one-field estimate
  ("Cost looks incomplete — add an estimated amount?"). FINISHED copy = physical completion.
- **PO-backed estimate:** one click creates an estimate invoice from a PO's priced lines.
- **Fallback chain (blast-radius fix):** channel residual value
  `fb = standardUnitCost ?? newest NON-provisional finished lot cog ?? newest provisional ?? 0`;
  monthlyCOGS uses the same; label value "at standard cost" when fb-sourced; alert when the
  fallback source flips (explains value steps).
- All money is the org's home currency — stated in UI copy; multi-currency deferred explicitly.

## 4. PAYMENT axis

dueDate/amountPaid/paidAt in the invoice editor; derived unpaid/partial/paid/overdue; Payables
filter/tab on Transactions (existing permission); due-soon + overdue alerts. Engine cannot read
these fields.

## 5. Onboarding / day-one

Connect Amazon → locked FBA/AWD facilities → first sync mirrors shipments; terminal-at-first-sync
= historical (no spam). Catalog bootstrap: offer one-click product import from FBA inventory
summaries (sellerSku/asin/name) so mapping isn't a manual wall. Getting Started gains "Set unit
costs for your Amazon stock" (Catalog, standardUnitCost) when Amazon-mapped snapshots exist with
no finished lots. Units correct from first sync; values labeled until real layers take over. No
fake history, ever. Wholesale-only brands see none of this and keep today's behavior exactly.

## 6. Herbl migration

Migration A backfills are engine-invisible → recompute must be bit-identical (diff every
LotLine.cogPerUnit; org COG total 269,846.21 unchanged). Mirror cutover: status-based historical
rule; batch 18's open AWD shipment goes live immediately — first sync removes the double count via
its virtual movement, Dashboard shows one card (finish lot 18 + estimate + record handoff).
One-time migration review screen lists live pre-cutoff shipments with link/ignore before the
virtual layer activates. InventoryValueSnapshot: one honest labeled release-day step, fix-forward.

## 7. Build order (each shippable)

1. **Cost + payment axes** (Migration A, toggles, badges, guards, payables). Verify: bit-identical
   recompute, anchor unchanged.
2. **Day-one valuation** (fallback chain + Catalog standardUnitCost + Getting Started step).
3. **SP-API plumbing read-only** (backoff, v0+v2024+AWD fetchers, origin + marketplace
   classification). Verify against Herbl's live Seller Central incl. batch 18's shipment.
4. **Mirror + links, invisible** (Migration B, sync upsert + high-water mark, health status,
   matcher, read-only panel, migration review). Verify days in staging: fidelity, zero number
   changes.
5. **Virtual handoff — the correctness moment** (lib/handoff.ts in both builders, netting, caps,
   facility FIFO, synthetic layers, chips, P-bucket exclusion, degraded banner). Verify:
   pre-cutoff numbers identical; batch-18 double count gone; step = deducted value exactly.
6. **Actions** (card with multi-lot finish + dry-run, panel actions, Ship button, MovementForm
   preselect, cancel-reversal alert, stock-take).
7. **Polish/opt-ins** (PO estimate button, discrepancy chips, auto-materialize org toggle with
   single-facility full-coverage guard + delete-suppression, Receive-from-Amazon, platform
   generalization for Shopify/TikTok).
