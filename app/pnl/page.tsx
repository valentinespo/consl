import { PageHeader } from "@/components/ui";
import { requireView } from "@/lib/membership";
import { getPnl, oldestFinanceDate, zonedDayBounds } from "@/lib/pnl";
import { getOrgSettings } from "@/lib/settings";
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
  const newest = new Date().toISOString().slice(0, 10);
  const oldest = (await oldestFinanceDate()) ?? newest;
  const b = rangeBounds(rangeKey, newest, str(sp.from), str(sp.to));

  // Days mean the org's business day (syncTz), so the statement's edges match how the operator
  // reads "a day" everywhere else in the app.
  const settings = await getOrgSettings();
  const bounds = zonedDayBounds(rangeKey === "all" ? oldest : (b.from ?? oldest), rangeKey === "all" ? newest : (b.to ?? newest), settings.syncTz);
  const from = bounds.from;
  const to = bounds.to;

  const pnl = await getPnl(from, to);

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
