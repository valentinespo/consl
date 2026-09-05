import "server-only";
import { prismaBase } from "@/lib/prisma-base";

/**
 * Daily reference exchange rates (ECB, published on business days), fetched once per day and
 * currency pair and kept in FxRate. A date with no fixing (weekend, holiday, today before the
 * fixing) resolves to the latest published one — the service does that rounding itself.
 */

const mem = new Map<string, number>();

export async function fxRate(from: string, to: string, at: Date): Promise<number> {
  if (from === to) return 1;
  const day = at.toISOString().slice(0, 10);
  const key = `${day}|${from}|${to}`;
  const hit = mem.get(key);
  if (hit) return hit;
  const cached = await prismaBase.fxRate.findUnique({ where: { day_base_quote: { day, base: from, quote: to } } });
  if (cached) {
    mem.set(key, cached.rate);
    return cached.rate;
  }
  let rate: number | null = null;
  try {
    const r = await fetch(`https://api.frankfurter.app/${day}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (r.ok) {
      const j = (await r.json()) as { rates?: Record<string, number> };
      const v = j.rates?.[to];
      if (typeof v === "number" && v > 0) rate = v;
    }
  } catch {
    // fall through to the nearest cached fixing
  }
  if (rate == null) {
    // The service is down or the pair is unknown: the most recent fixing we hold keeps imports
    // flowing; with none at all the import fails and retries rather than guessing a rate.
    const near = await prismaBase.fxRate.findFirst({ where: { base: from, quote: to, day: { lte: day } }, orderBy: { day: "desc" } });
    if (!near) throw new Error(`no ${from}→${to} exchange rate for ${day}`);
    return near.rate;
  }
  await prismaBase.fxRate.upsert({
    where: { day_base_quote: { day, base: from, quote: to } },
    create: { day, base: from, quote: to, rate },
    update: { rate },
  });
  mem.set(key, rate);
  return rate;
}
