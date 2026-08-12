/**
 * Finished-goods FIFO engine — pure, deterministic, no DB/IO.
 *
 * The mirror of the raw-material engine (lib/fifo.ts), one level up:
 *   raw materials : purchases  -> production lots   (pool: material x facility)
 *   finished goods: lot lines  -> stock movements   (pool: SKU x facility)
 *
 * A finished lot's units start at the facility that produced them, valued at that lot line's
 * already-computed `cogPerUnit`. Movements consume oldest-first; a transfer between your own
 * facilities carries the unit cost with it, so nothing is created or destroyed in transit.
 *
 * Units sent OUT of your network (a sales channel, a customer, or written off) leave the pools.
 * The cost of the units sent to each destination is reported back, because Amazon's stock must be
 * valued from what was actually shipped to Amazon — never from lots still sitting elsewhere.
 */

/** A batch of finished units produced by one lot line, available at its production facility. */
export interface FinishedSupply {
  sku: string;
  facilityId: string;
  units: number;
  unitCost: number; // the lot line's cogPerUnit
  date: number; // epoch ms — orders the FIFO stack
  seq: number; // stable tie-breaker
}

/** Units moving between places. Exactly one SOURCE (fromFacilityId | fromDestination) and one
 *  TARGET (toFacilityId | toDestination) is set. A fromDestination source is stock coming BACK
 *  from a sales channel (an Amazon removal order being the archetype) — it consumes that
 *  channel's shipped layers oldest-first, so the units re-enter carrying the cost they left with. */
export interface FinishedMovement {
  id: string;
  sku: string;
  fromFacilityId: string | null;
  fromDestination?: string | null; // AMAZON | SHOPIFY | TIKTOK — channel the stock returns from
  toFacilityId: string | null;
  toDestination: string | null; // AMAZON | SHOPIFY | TIKTOK | CUSTOMER | LOSS
  quantity: number;
  date: number;
  seq: number;
}

/** What's left in one (SKU, facility) pool. */
export interface FinishedPool {
  sku: string;
  facilityId: string;
  units: number;
  value: number;
}

/** A layer of units that left the network, tagged with the destination and the cost they carried. */
export interface ShippedLayer {
  sku: string;
  destination: string;
  units: number;
  unitCost: number;
  date: number;
}

/** A movement that asked for more units than the location actually held. */
export interface MovementShortfall {
  movementId: string;
  sku: string;
  facilityId: string;
  requested: number;
  available: number;
  shortBy: number;
}

export interface FinishedResult {
  pools: FinishedPool[]; // remaining stock at your own facilities
  shipped: ShippedLayer[]; // units that left the network, with their carried cost
  shortfalls: MovementShortfall[];
}

const key = (sku: string, facilityId: string) => `${sku}|${facilityId}`;

/** A FIFO stack of finished-unit layers for one (SKU, facility) pool. */
class FinishedPoolStack {
  private layers: { units: number; unitCost: number; date: number; seq: number }[] = [];

  add(units: number, unitCost: number, date: number, seq: number) {
    if (units > 0) this.layers.push({ units, unitCost, date, seq });
  }

  /** Consume oldest-first. Returns the layers actually drawn (so cost can travel with them). */
  take(demand: number): { drawn: { units: number; unitCost: number }[]; consumed: number } {
    this.layers.sort((a, b) => a.date - b.date || a.seq - b.seq);
    const drawn: { units: number; unitCost: number }[] = [];
    let remaining = demand;
    while (remaining > 1e-9 && this.layers.length > 0) {
      const layer = this.layers[0];
      const take = Math.min(layer.units, remaining);
      drawn.push({ units: take, unitCost: layer.unitCost });
      layer.units -= take;
      remaining -= take;
      if (layer.units <= 1e-9) this.layers.shift();
    }
    return { drawn, consumed: demand - remaining };
  }

  remaining(): { units: number; value: number } {
    let units = 0;
    let value = 0;
    for (const l of this.layers) {
      units += l.units;
      value += l.units * l.unitCost;
    }
    return { units, value };
  }

  /** The remaining layers themselves, oldest-first — channel ledgers read these back out. */
  layers_(): { units: number; unitCost: number; date: number; seq: number }[] {
    this.layers.sort((a, b) => a.date - b.date || a.seq - b.seq);
    return this.layers.filter((l) => l.units > 1e-9);
  }
}

export function runFinishedGoodsEngine(
  supply: FinishedSupply[],
  movements: FinishedMovement[],
  /** Day-zero layers already sitting AT a channel (onboarding starting balances). */
  channelSeed: ShippedLayer[] = [],
  /** Cost for units pulled back from a channel beyond its recorded layers (newest lot cost). */
  fallbackCostBySku?: Map<string, number>,
): FinishedResult {
  const pools = new Map<string, FinishedPoolStack>();
  const stackFor = (sku: string, facilityId: string) => {
    const k = key(sku, facilityId);
    let p = pools.get(k);
    if (!p) pools.set(k, (p = new FinishedPoolStack()));
    return p;
  };

  // Seed every pool with what its facility produced.
  for (const s of supply) stackFor(s.sku, s.facilityId).add(s.units, s.unitCost, s.date, s.seq);

  // Per (channel, SKU) ledger of everything that entered that channel — starting balances plus
  // recorded shipments. Valuation covers the channel's reported count from the NEWEST of these;
  // a movement back OUT of the channel consumes the OLDEST (the same end sales eat from), so the
  // remaining layers stay consistent with "what's still there is the freshest stock".
  const channelLedgers = new Map<string, FinishedPoolStack>();
  const ledgerFor = (destination: string, sku: string) => {
    const k = key(sku, destination);
    let p = channelLedgers.get(k);
    if (!p) channelLedgers.set(k, (p = new FinishedPoolStack()));
    return p;
  };
  channelSeed.forEach((l, i) => ledgerFor(l.destination, l.sku).add(l.units, l.unitCost, l.date, -channelSeed.length + i));

  const shortfalls: MovementShortfall[] = [];

  // Replay movements in chronological order so transfers chain correctly.
  const ordered = [...movements].sort((a, b) => a.date - b.date || a.seq - b.seq);
  for (const m of ordered) {
    // Stock leaving a channel: consume its ledger oldest-first, and land the drawn layers — with
    // the cost they left with — wherever they're headed: one of your facilities, ANOTHER channel
    // (an AWD shipment to your Shopify 3PL), or out of inventory entirely (a disposal removal,
    // a wholesale order shipped straight from the channel).
    if (m.fromDestination) {
      if (m.toDestination === m.fromDestination) continue; // same-channel no-op
      const ledger = ledgerFor(m.fromDestination, m.sku);
      const { drawn, consumed } = ledger.take(m.quantity);
      const short = m.quantity - consumed;
      if (short > 1e-6) {
        // More units than we ever recorded entering the channel — carry them at the fallback cost
        // rather than losing them, and report the gap.
        drawn.push({ units: short, unitCost: fallbackCostBySku?.get(m.sku) ?? 0 });
        shortfalls.push({
          movementId: m.id,
          sku: m.sku,
          facilityId: m.fromDestination,
          requested: m.quantity,
          available: consumed,
          shortBy: short,
        });
      }
      if (m.toFacilityId) {
        const to = stackFor(m.sku, m.toFacilityId);
        for (const d of drawn) to.add(d.units, d.unitCost, m.date, m.seq);
      } else if (m.toDestination && m.toDestination !== "CUSTOMER" && m.toDestination !== "LOSS") {
        const to = ledgerFor(m.toDestination, m.sku);
        for (const d of drawn) to.add(d.units, d.unitCost, m.date, m.seq);
      }
      // CUSTOMER / LOSS: the layers simply leave — consumed above, landed nowhere.
      continue;
    }

    if (!m.fromFacilityId) continue; // openings are handled by the callers as supply/seed
    const from = stackFor(m.sku, m.fromFacilityId);
    const { drawn, consumed } = from.take(m.quantity);

    if (consumed + 1e-6 < m.quantity) {
      shortfalls.push({
        movementId: m.id,
        sku: m.sku,
        facilityId: m.fromFacilityId,
        requested: m.quantity,
        available: consumed,
        shortBy: m.quantity - consumed,
      });
    }

    if (m.toFacilityId) {
      // Transfer: the same units, at the same cost, now live at the destination.
      const to = stackFor(m.sku, m.toFacilityId);
      for (const d of drawn) to.add(d.units, d.unitCost, m.date, m.seq);
    } else if (m.toDestination) {
      // Left the network — its channel ledger records what those units cost us.
      const ledger = ledgerFor(m.toDestination, m.sku);
      for (const d of drawn) ledger.add(d.units, d.unitCost, m.date, m.seq);
    }
  }

  const out: FinishedPool[] = [];
  for (const [k, stack] of pools) {
    const [sku, facilityId] = k.split("|");
    const r = stack.remaining();
    if (r.units > 1e-6) out.push({ sku, facilityId, units: r.units, value: r.value });
  }

  // What's still recorded as being AT each channel (shipments minus pull-backs), for valuation.
  const shipped: ShippedLayer[] = [];
  for (const [k, stack] of channelLedgers) {
    const [sku, destination] = k.split("|");
    for (const l of stack.layers_()) {
      shipped.push({ sku, destination, units: l.units, unitCost: l.unitCost, date: l.date });
    }
  }

  return { pools: out, shipped, shortfalls };
}

/**
 * Value a channel's reported on-hand units from what was actually shipped to that channel.
 * Newest shipments first — what's still sitting at a channel is the most recently sent stock.
 *
 * `needs` are filled in order from ONE shared newest-first pass, so sub-buckets of the same
 * channel (Amazon FBA then AWD) can never draw the same layer twice. Units beyond anything we
 * recorded shipping fall back to `fallbackUnitCost` (pre-ledger history / unrecorded movements).
 */
export function valueChannelStock(
  shippedLayers: ShippedLayer[],
  needs: number[],
  fallbackUnitCost: number,
): number[] {
  const remaining = [...shippedLayers]
    .sort((a, b) => b.date - a.date)
    .map((l) => ({ units: l.units, unitCost: l.unitCost }));
  let idx = 0;

  return needs.map((need) => {
    let want = need;
    let value = 0;
    while (want > 1e-9 && idx < remaining.length) {
      const layer = remaining[idx];
      const take = Math.min(layer.units, want);
      value += take * layer.unitCost;
      layer.units -= take;
      want -= take;
      if (layer.units <= 1e-9) idx++;
    }
    if (want > 1e-9) value += want * fallbackUnitCost;
    return value;
  });
}
