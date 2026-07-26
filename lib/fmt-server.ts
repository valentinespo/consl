import "server-only";
import { cache } from "react";
import {
  money as fmtMoney,
  perUnit as fmtPerUnit,
  costFine as fmtCostFine,
  qty as fmtQty,
  date as fmtDate,
  type Currency,
} from "@/lib/format";
import { getCurrentOrg } from "@/lib/org";

/** Formatters bound to the current org's currency and locale, for SERVER components/pages.
 *  Cached per request. Client components use `useMoney()` from CurrencyProvider instead. */
export const getFmt = cache(async () => {
  const org = await getCurrentOrg().catch(() => null);
  const cur: Currency = {
    symbol: org?.currencySymbol ?? "$",
    locale: org?.locale ?? "en-US",
    code: org?.currencyCode ?? "USD",
  };
  return {
    money: (n: number | null | undefined, dp = 2) => fmtMoney(n, dp, cur),
    money0: (n: number | null | undefined) => fmtMoney(n, 0, cur),
    perUnit: (n: number | null | undefined) => fmtPerUnit(n, cur),
    costFine: (n: number | null | undefined) => fmtCostFine(n, cur),
    qty: (n: number | null | undefined) => fmtQty(n, cur),
    date: (d: Date | string | null | undefined) => fmtDate(d, cur),
  };
});
