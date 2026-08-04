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

/** Units leaving one of your facilities. Exactly one of toFacilityId / toDestination is set.
 *  `fromFacilityId: null` is a GLOBAL drain (virtual handoff): the units leave whichever pools
 *  hold the SKU, oldest layer first across every facility — facility attribution is inferred.
 *  `channelHint` marks WHICH channel bucket the units went to when known (a mirrored shipment's
 *  FBA/AWD) — it travels onto the shipped layers so valuation lands in the right bucket. */
export interface FinishedMovement {
  id: string;
  sku: string;
  fromFacilityId: string | null;
  toFacilityId: string | null;
  toDestination: string | null; // AMAZON | SHOPIFY | TIKTOK | CUSTOMER | LOSS
  channelHint?: string | null; // e.g. "FBA" | "AWD" — null when the operator just said "Amazon"
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

/** A layer of units that left the network, tagged with the destination and the cost they carried.
 *  `channel` narrows the destination to a specific channel bucket (FBA/AWD) when known. */
export interface ShippedLayer {
  sku: string;
  destination: string;
  channel?: string | null;
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

  /** The (date, seq) of the oldest layer, or null when empty — for global-FIFO across pools. */
  peekOldest(): { date: number; seq: number } | null {
    if (this.layers.length === 0) return null;
    this.layers.sort((a, b) => a.date - b.date || a.seq - b.seq);
    return { date: this.layers[0].date, seq: this.layers[0].seq };
  }

  /** Consume at most the OLDEST layer (a single layer), up to `demand` units. */
  takeHead(demand: number): { units: number; unitCost: number } | null {
    this.layers.sort((a, b) => a.date - b.date || a.seq - b.seq);
    const layer = this.layers[0];
    if (!layer) return null;
    const take = Math.min(layer.units, demand);
    layer.units -= take;
    if (layer.units <= 1e-9) this.layers.shift();
    return { units: take, unitCost: layer.unitCost };
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
}

export function runFinishedGoodsEngine(supply: FinishedSupply[], movements: FinishedMovement[]): FinishedResult {
  const pools = new Map<string, FinishedPoolStack>();
  const skuFacilities = new Map<string, Set<string>>(); // which facilities ever held the SKU
  const stackFor = (sku: string, facilityId: string) => {
    const k = key(sku, facilityId);
    let p = pools.get(k);
    if (!p) pools.set(k, (p = new FinishedPoolStack()));
    let f = skuFacilities.get(sku);
    if (!f) skuFacilities.set(sku, (f = new Set()));
    f.add(facilityId);
    return p;
  };

  // Seed every pool with what its facility produced.
  for (const s of supply) stackFor(s.sku, s.facilityId).add(s.units, s.unitCost, s.date, s.seq);

  const shipped: ShippedLayer[] = [];
  const shortfalls: MovementShortfall[] = [];

  // Replay movements in chronological order so transfers chain correctly.
  const ordered = [...movements].sort((a, b) => a.date - b.date || a.seq - b.seq);
  for (const m of ordered) {
    if (m.fromFacilityId === null) {
      // Global drain (virtual handoff): consume the globally-oldest layer first across every
      // facility holding the SKU — one head layer at a time, stable facility-id tiebreak.
      let remaining = m.quantity;
      const drawn: { units: number; unitCost: number }[] = [];
      const facs = [...(skuFacilities.get(m.sku) ?? [])].sort();
      while (remaining > 1e-9) {
        let best: { fac: string; date: number; seq: number } | null = null;
        for (const f of facs) {
          const head = stackFor(m.sku, f).peekOldest();
          if (!head) continue;
          if (!best || head.date < best.date || (head.date === best.date && head.seq < best.seq)) {
            best = { fac: f, ...head };
          }
        }
        if (!best) break;
        const d = stackFor(m.sku, best.fac).takeHead(remaining);
        if (!d || d.units <= 1e-9) break;
        drawn.push(d);
        remaining -= d.units;
      }
      const consumed = m.quantity - remaining;
      if (consumed + 1e-6 < m.quantity) {
        shortfalls.push({ movementId: m.id, sku: m.sku, facilityId: "", requested: m.quantity, available: consumed, shortBy: m.quantity - consumed });
      }
      if (m.toDestination) {
        for (const d of drawn) {
          shipped.push({ sku: m.sku, destination: m.toDestination, channel: m.channelHint ?? null, units: d.units, unitCost: d.unitCost, date: m.date });
        }
      }
      continue;
    }
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
      // Left the network — record what it cost us, per destination.
      for (const d of drawn) {
        shipped.push({ sku: m.sku, destination: m.toDestination, channel: m.channelHint ?? null, units: d.units, unitCost: d.unitCost, date: m.date });
      }
    }
  }

  const out: FinishedPool[] = [];
  for (const [k, stack] of pools) {
    const [sku, facilityId] = k.split("|");
    const r = stack.remaining();
    if (r.units > 1e-6) out.push({ sku, facilityId, units: r.units, value: r.value });
  }

  return { pools: out, shipped, shortfalls };
}

/**
 * Value a channel's reported on-hand units from what was actually shipped to that channel.
 * Newest shipments first — what's still sitting at a channel is the most recently sent stock.
 *
 * Two passes. Layers tagged with a specific channel (a mirrored FBA/AWD shipment — we KNOW where
 * those units went) fill THAT bucket first, so a batch shipped to AWD is valued in AWD, never
 * smeared onto FBA's older stock. Untagged history (operator-recorded "to Amazon" movements) plus
 * any tagged leftovers (Amazon shuffles stock between its warehouses internally) then fill the
 * rest in ONE shared newest-first pass, so buckets can never draw the same layer twice. Units
 * beyond anything we recorded shipping fall back to `fallbackUnitCost`.
 */
export function valueChannelStock(
  shippedLayers: ShippedLayer[],
  needs: { qty: number; channel: string }[],
  fallbackUnitCost: number,
): number[] {
  const layers = [...shippedLayers]
    .sort((a, b) => b.date - a.date)
    .map((l) => ({ units: l.units, unitCost: l.unitCost, channel: l.channel ?? null }));
  const want = needs.map((n) => n.qty);
  const value = needs.map(() => 0);

  // Pass 1: channel-tagged layers into their own bucket.
  for (let i = 0; i < needs.length; i++) {
    for (const l of layers) {
      if (want[i] <= 1e-9) break;
      if (l.channel !== needs[i].channel || l.units <= 1e-9) continue;
      const take = Math.min(l.units, want[i]);
      value[i] += take * l.unitCost;
      l.units -= take;
      want[i] -= take;
    }
  }

  // Pass 2: whatever's left (untagged history + tagged leftovers), shared, newest first.
  let idx = 0;
  for (let i = 0; i < needs.length; i++) {
    while (want[i] > 1e-9 && idx < layers.length) {
      const l = layers[idx];
      if (l.units <= 1e-9) {
        idx++;
        continue;
      }
      const take = Math.min(l.units, want[i]);
      value[i] += take * l.unitCost;
      l.units -= take;
      want[i] -= take;
    }
    if (want[i] > 1e-9) value[i] += want[i] * fallbackUnitCost;
  }
  return value;
}
