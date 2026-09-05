import { PageHeader } from "@/components/ui";
import { requireView } from "@/lib/membership";
import { getPnl, oldestFinanceDate, zonedDayBounds } from "@/lib/pnl";
import { getOrgSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { channelTimezone, describeTimezone, todayIn } from "@/lib/channel-tz";
import { PnlClient } from "@/components/PnlClient";
import { rangeBounds, RANGES, type RangeKey } from "@/lib/chart";

export const dynamic = "force-dynamic";

/**
 * P&L — the Sellerise-shaped statement over the imported Amazon financial ledger: every money
 * movement bucketed (sales, fees, refunds, ads, storage…), plus engine-priced COGS. Amazon first;
 * Shopify/TikTok join once their ledgers are imported.
 */
export default async function PnlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireView("dashboard");
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

  const isKey = (v: string | undefined): v is RangeKey => !!v && RANGES.some((r) => r.key === v);
  const rangeKey: RangeKey = isKey(str(sp.range)) ? (str(sp.range) as RangeKey) : "30";

  // Which clock cuts a "day": the channel's own (Amazon.com reports on Pacific time, so the
  // statement matches Seller Central line for line) or the company's business day, the calendar
  // the rest of the app reads. The channel's is the default for a single-channel statement.
  const settings = await getOrgSettings();
  const amazon = await prisma.integration.findFirst({
    where: { provider: "amazon", status: "connected" },
    select: { provider: true, timezone: true, marketplaceId: true, region: true },
  });
  const channelTz = amazon ? channelTimezone(amazon) : null;
  const dayBasis: "channel" | "company" = str(sp.day) === "company" || !channelTz ? "company" : "channel";
  const tz = dayBasis === "channel" && channelTz ? channelTz : settings.syncTz;

  const newest = todayIn(tz);
  const oldest = (await oldestFinanceDate()) ?? newest;
  const b = rangeBounds(rangeKey, newest, str(sp.from), str(sp.to));
  const bounds = zonedDayBounds(rangeKey === "all" ? oldest : (b.from ?? oldest), rangeKey === "all" ? newest : (b.to ?? newest), tz);
  const pnl = await getPnl(bounds.from, bounds.to);

  return (
    <>
      <PageHeader title="P&L" subtitle="Every dollar Amazon moved, period by period — and what was left." />
      <PnlClient
        pnl={pnl}
        filter={{ range: { key: rangeKey, from: b.from ?? oldest, to: b.to ?? newest } }}
        dataBounds={{ newest, oldest }}
        day={{
          basis: dayBasis,
          channel: channelTz ? describeTimezone(channelTz) : null,
          company: describeTimezone(settings.syncTz),
        }}
      />
    </>
  );
}
