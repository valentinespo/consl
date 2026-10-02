import "server-only";
import { Prisma } from "@/app/generated/prisma/client";
import { prismaBase } from "@/lib/prisma-base";
import { runWithOrg } from "@/lib/tenant";
import { getRestock, readStockCounts, type RestockTotals, type StockCounts } from "@/lib/restock";

/**
 * A company's stock at the end of each of its days (its own clock).
 *
 * Seconds after midnight, consl reads the units every channel holds (fresh from the platforms)
 * and saves them with what the stock was worth — the closing for the day that just ended. The
 * units are the one part that can't be worked out again later; everything else can. So a day's
 * value is always worked out again from its saved units with what consl knows NOW: a bill,
 * purchase, production run or stock move dated that day or earlier but entered (or changed)
 * after the night it closed counts, and the change is listed with what caused it. Only the part
 * of a late bill that sat in the stock that night counts (FIFO: units sold before it are not
 * stock). A bill dated after the day never does: it reaches the books on its own date.
 *
 * Days before closings began (or a night consl wasn't running) have no closing: callers fall
 * back to the day's dashboard record (InventoryValueSnapshot).
 */

/** The end of a calendar day as consl compares dates against it: business dates (a bill's, a
 *  purchase's, a lot's) are stored as that day at 00:00 UTC, so the day's last UTC millisecond
 *  takes exactly the ones dated that day or earlier. */
export const endOfDay = (day: string) => new Date(`${day}T23:59:59.999Z`);

/** The closing is taken in the first minutes of the new day only. Later, the channels' units are
 *  no longer that night's, so a missed night stays missing rather than saved with wrong units. */
export const CLOSE_WINDOW_MIN = 5;

const cents = (n: number) => Math.round(n * 100) / 100;

export type ClosingFigures = { total: number; raw: number; inProduction: number; finished: number };
const figures = (t: Pick<RestockTotals, "total" | "raw" | "inProduction">): ClosingFigures => ({
  total: cents(t.total),
  raw: cents(t.raw),
  inProduction: cents(t.inProduction),
  finished: cents(t.total - t.raw - t.inProduction),
});

/**
 * Save a day's closing for the company in context: `refreshUnits` first reads fresh units from
 * the channels (the scheduler passes its locked stock reads), then the units are saved with the
 * day's value. Returns false when another process saved it first.
 */
export async function captureClose(orgId: string, day: string, refreshUnits: () => Promise<void>): Promise<{ saved: boolean; total: number; seconds: number }> {
  const t0 = Date.now();
  await refreshUnits();
  const capturedAt = new Date();
  const counts = await readStockCounts();
  const t = (await getRestock({ asOf: endOfDay(day), counts })).totals;
  const data = {
    day,
    capturedAt,
    counts: counts as unknown as Prisma.InputJsonValue,
    raw: t.raw,
    inProduction: t.inProduction,
    fba: t.fba,
    awd: t.awd,
    shopify: t.shopify,
    tiktok: t.tiktok,
    atLocations: t.atLocations,
    total: t.total,
  };
  try {
    await prismaBase.inventoryClose.create({ data: { orgId, ...data } });
  } catch (e) {
    // The unique (company, day) key: another replica closed this day first.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { saved: false, total: t.total, seconds: (Date.now() - t0) / 1000 };
    throw e;
  }
  return { saved: true, total: t.total, seconds: (Date.now() - t0) / 1000 };
}

/** Something dated on or before a closed day that was entered or changed after it closed. */
export type ClosingChange = { what: string; date: string; at: string; amount: number | null };

export type ClosingValue = {
  day: string;
  /** When the channels' units were read (seconds after that midnight). */
  capturedAt: string;
  /** What the stock was worth that night, as saved. */
  saved: ClosingFigures;
  /** What it was worth, worked out again now (the number to use). */
  now: ClosingFigures;
  /** What changed it since: records dated that day or earlier, entered or changed after it closed. */
  changes: ClosingChange[];
  /** More such records than listed. */
  moreChanges: number;
};

const LIST = 6;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** A closed day's value now, or null when the day has no closing. */
export async function closingValue(orgId: string, day: string): Promise<ClosingValue | null> {
  const close = await prismaBase.inventoryClose.findFirst({ where: { orgId, day } });
  if (!close) return null;
  const cut = endOfDay(day);
  const now = figures((await runWithOrg(orgId, () => getRestock({ asOf: cut, counts: close.counts as unknown as StockCounts }))).totals);
  const saved = figures(close);
  const out: ClosingValue = { day, capturedAt: close.capturedAt.toISOString(), saved, now, changes: [], moreChanges: 0 };
  if (Math.abs(now.total - saved.total) < 0.005) return out;

  // What moved it: anything dated up to that day, entered or changed after the night it closed.
  // (A record deleted since leaves no trace to list; the difference still shows.)
  const after = close.capturedAt;
  const touched = { OR: [{ createdAt: { gt: after } }, { updatedAt: { gt: after } }] };
  const [bills, purchases, lots, moves] = await Promise.all([
    prismaBase.transactionInvoice.findMany({
      where: { orgId, draft: false, date: { lte: cut }, ...touched },
      select: { date: true, createdAt: true, updatedAt: true, supplier: { select: { name: true } }, lines: { select: { applicableAmount: true, appliesToCog: true } } },
    }),
    prismaBase.purchaseInvoice.findMany({
      where: { orgId, date: { lte: cut }, ...touched },
      select: { date: true, createdAt: true, updatedAt: true, invoiceTotal: true, supplier: { select: { name: true } }, materialType: { select: { name: true } } },
    }),
    prismaBase.lot.findMany({
      where: { orgId, OR: [{ poDate: { lte: cut } }, { poDate: null, createdAt: { lte: cut } }], AND: [touched] },
      select: { lotNr: true, poDate: true, createdAt: true, updatedAt: true },
    }),
    prismaBase.stockMovement.findMany({
      where: { orgId, date: { lte: cut }, createdAt: { gt: after } },
      select: { date: true, createdAt: true, quantity: true, kind: true, product: { select: { name: true } }, materialType: { select: { name: true } } },
    }),
  ]);
  const when = (c: Date, u: Date) => (c > after ? c : u);
  const all: ClosingChange[] = [
    ...bills.map((b) => ({
      what: `Bill from ${b.supplier?.name ?? "a supplier"}`,
      date: b.date ? iso(b.date) : day,
      at: when(b.createdAt, b.updatedAt).toISOString(),
      amount: cents(b.lines.filter((l) => l.appliesToCog).reduce((s, l) => s + l.applicableAmount, 0)),
    })),
    ...purchases.map((p) => ({
      what: `Purchase of ${p.materialType.name}${p.supplier?.name ? ` from ${p.supplier.name}` : ""}`,
      date: iso(p.date),
      at: when(p.createdAt, p.updatedAt).toISOString(),
      amount: cents(p.invoiceTotal),
    })),
    ...lots.map((l) => ({ what: `Production run ${l.lotNr}`, date: iso(l.poDate ?? l.createdAt), at: when(l.createdAt, l.updatedAt).toISOString(), amount: null })),
    ...moves.map((m) => ({
      what: `${m.kind === "OPENING" ? "Starting stock" : "Stock move"} of ${m.quantity} ${m.product?.name ?? m.materialType?.name ?? "units"}`,
      date: iso(m.date),
      at: m.createdAt.toISOString(),
      amount: null,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  out.changes = all.slice(0, LIST);
  out.moreChanges = Math.max(0, all.length - LIST);
  return out;
}

/** The day a company's closing is due for: the day that just ended, during the first minutes
 *  after its midnight (`tzNow` = its own clock); null the rest of the day. */
export function dayToClose(tzNow: { day: string; minutes: number }): string | null {
  if (tzNow.minutes >= CLOSE_WINDOW_MIN) return null;
  const [y, m, d] = tzNow.day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}
