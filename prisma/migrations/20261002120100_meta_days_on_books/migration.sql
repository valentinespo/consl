-- Meta's daily spend keeps the date Meta reported on the company's books: noon of that date on the
-- company's clock. Rows were stamped at midnight of the ad account's own time zone, which on books
-- running on an earlier zone (account on New York time, books on Los Angeles) fell on the day
-- before. The importer stamps new rows the same way (lib/meta-ads-spend.ts). No amount moves.
UPDATE "FinanceEvent" fe
SET "eventAt" = ((split_part(fe."txId", ':', 3) || ' 12:00:00')::timestamp AT TIME ZONE s."syncTz") AT TIME ZONE 'UTC',
    "postedAt" = ((split_part(fe."txId", ':', 3) || ' 12:00:00')::timestamp AT TIME ZONE s."syncTz") AT TIME ZONE 'UTC'
FROM "Settings" s
WHERE s."orgId" = fe."orgId" AND fe."txId" LIKE 'meta:%' AND split_part(fe."txId", ':', 3) ~ '^\d{4}-\d{2}-\d{2}$';
