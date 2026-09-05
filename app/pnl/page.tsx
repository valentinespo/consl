import { PageHeader } from "@/components/ui";
import { requireView } from "@/lib/membership";
import { getPnl, oldestFinanceDate, zonedDayBounds } from "@/lib/pnl";
import { getOrgSettings } from "@/lib/settings";
import { todayIn } from "@/lib/channel-tz";
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

  // Days are the company's business day (syncTz) — the one calendar every channel and every
  // screen in the app shares, so a day here is the same 24 hours as on the dashboard and the
  // Orders tab. (A channel's own clock — Amazon cuts its day on Pacific time — is recorded on the
  // connection for reconciliation, never for display.)
  const settings = await getOrgSettings();
  const tz = settings.syncTz;

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
      />
    </>
  );
}
