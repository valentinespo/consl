"use client";

import { createContext, useContext, useMemo } from "react";
import { money as fmtMoney, perUnit as fmtPerUnit, costFine as fmtCostFine, USD, type Currency } from "@/lib/format";

const CurrencyCtx = createContext<Currency>(USD);

/** Seeds the org's currency for every client component below it. Safe per-tenant because the
 *  client bundle only ever renders one signed-in company. Server code uses `getFmt` instead. */
export function CurrencyProvider({ symbol, locale, children }: { symbol: string; locale: string; children: React.ReactNode }) {
  const cur = useMemo<Currency>(() => ({ symbol, locale }), [symbol, locale]);
  return <CurrencyCtx.Provider value={cur}>{children}</CurrencyCtx.Provider>;
}

/** Money formatters bound to the current org's currency. Drop-in for the `@/lib/format` calls
 *  (`money`, `money0`, `perUnit`, `costFine`) inside client components. */
export function useMoney() {
  const cur = useContext(CurrencyCtx);
  return useMemo(
    () => ({
      money: (n: number | null | undefined, dp = 2) => fmtMoney(n, dp, cur),
      money0: (n: number | null | undefined) => fmtMoney(n, 0, cur),
      perUnit: (n: number | null | undefined) => fmtPerUnit(n, cur),
      costFine: (n: number | null | undefined) => fmtCostFine(n, cur),
    }),
    [cur],
  );
}
