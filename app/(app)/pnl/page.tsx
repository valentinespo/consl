import { PageHeader } from "@/components/ui";
import { requireView } from "@/lib/membership";
import { getPnl, oldestFinanceDate, presentPnlChannels, zonedDayBounds, type PnlChannel } from "@/lib/pnl";
import { getOrgSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { todayIn } from "@/lib/channel-tz";
import { PnlClient, PreConslCostButton } from "@/components/PnlClient";
import { rangeBounds, RANGES, type RangeKey } from "@/lib/chart";
import { parsePnlBreakdown } from "@/lib/pnl-shared";
import { isPnlDay, pnlPeriodRanges } from "@/lib/pnl-periods";

export const dynamic = "force-dynamic";

/**
 * P&L — the Sellerise-shaped statement over every channel's ledger: each money movement bucketed
 * (sales, fees, refunds, ads, storage…), plus engine-priced COGS from one FIFO queue per product.
 * One channel at a time or all together, on the company's own calendar.
 */
export default async function PnlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireView("dashboard");
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

  const isKey = (v: string | undefined): v is RangeKey => !!v && RANGES.some((r) => r.key === v);
  const rangeKey: RangeKey = isKey(str(sp.range)) ? (str(sp.range) as RangeKey) : "30";

  // Days are the company's business day (syncTz) — the one calendar every channel and every
  // screen in the app shares, so a day here is the same 24 hours as on the dashboard and the
  // Orders tab. (A channel's own clock — Amazon cuts its day on Pacific time — is recorded on the
  // connection for reconciliation, never for display.)
  const settings = await getOrgSettings();
  const tz = settings.syncTz;

  const present = await presentPnlChannels();
  const channelParam = str(sp.channel)?.toUpperCase();
  const channel = channelParam && (present as string[]).includes(channelParam) ? (channelParam as PnlChannel) : undefined;

  const newest = todayIn(tz);
  const oldest = (await oldestFinanceDate(tz)) ?? newest;
  const b = rangeBounds(rangeKey, newest, str(sp.from), str(sp.to));
  const start = isPnlDay(b.from) ? b.from : oldest;
  const end = isPnlDay(b.to) ? b.to : newest;
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  const breakdown = parsePnlBreakdown(str(sp.breakdown));
  const bounds = zonedDayBounds(from, to, tz);
  const { periods, ...pnl } = await getPnl(bounds.from, bounds.to, channel ? [channel] : undefined, {
    ranges: pnlPeriodRanges(from, to, breakdown), timeZone: tz,
  });
  const products = await prisma.product.findMany({
    where: { sellerSku: { not: null } },
    select: { id: true, code: true, name: true, imageUrl: true, preConslUnitCost: true, openingUnitCost: true },
    orderBy: { code: "asc" },
  });

  return (
    <>
      <PageHeader title="P&L" subtitle="Every dollar your channels moved, period by period — and what was left.">
        <PreConslCostButton products={products} />
      </PageHeader>
      <PnlClient
        pnl={pnl}
        periods={periods}
        channels={present}
        filter={{ channel: channel ?? "", range: { key: rangeKey, from, to }, breakdown }}
        dataBounds={{ newest, oldest }}
      />
    </>
  );
}
