import "server-only";
import { cache } from "react";
import { money as fmtMoney, perUnit as fmtPerUnit, costFine as fmtCostFine, type Currency } from "@/lib/format";
import { getCurrentOrg } from "@/lib/org";

/** Money formatters bound to the current org's currency, for SERVER components/pages.
 *  Cached per request. Client components use `useMoney()` from CurrencyProvider instead. */
export const getFmt = cache(async () => {
  const org = await getCurrentOrg().catch(() => null);
  const cur: Currency = { symbol: org?.currencySymbol ?? "$", locale: org?.locale ?? "en-US" };
  return {
    money: (n: number | null | undefined, dp = 2) => fmtMoney(n, dp, cur),
    money0: (n: number | null | undefined) => fmtMoney(n, 0, cur),
    perUnit: (n: number | null | undefined) => fmtPerUnit(n, cur),
    costFine: (n: number | null | undefined) => fmtCostFine(n, cur),
  };
});
