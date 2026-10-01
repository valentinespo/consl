-- Money a channel holds back from a payout and releases later is cash timing, not profit: TikTok's
-- reserve (held / released) and Amazon's reserve credit / debit leave the P&L. The rows stay in the
-- ledger (TikTok's payouts still reconcile) under "cash", which no statement line sums. The
-- importers file new rows the same way (lib/tiktok-finance-import.ts, amazonSection in lib/finances.ts).
UPDATE "FinanceEvent" SET "group" = 'cash'
WHERE (channel = 'TIKTOK' AND type IN ('Reserve held', 'Reserve released'))
   OR (channel = 'AMAZON' AND "group" = 'other' AND lower(type) IN ('reservecredit', 'reservedebit'));
