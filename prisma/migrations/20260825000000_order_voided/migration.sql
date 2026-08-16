-- Voided orders: out of every total, washed out in the list. Auto rules at import; manual pin
-- from the row menu. Backfill applies the same auto rules to existing rows.
ALTER TABLE "SalesOrder"
  ADD COLUMN "voided" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "voidedManual" BOOLEAN NOT NULL DEFAULT false;

-- Cancelled orders were always excluded — now that's spelled "voided".
UPDATE "SalesOrder" SET "voided" = true WHERE "cancelled" = true;

-- Amazon free units: shipped, $0, not MCF, not a replacement.
UPDATE "SalesOrder" SET "voided" = true
WHERE "channel" = 'AMAZON' AND "total" = 0 AND "mcf" = false AND "replacement" = false
  AND "cancelled" = false AND "status" IN ('Shipped', 'PartiallyShipped');

-- TikTok free samples: the buyer paid $0.
UPDATE "SalesOrder" SET "voided" = true
WHERE "channel" = 'TIKTOK' AND "total" = 0 AND "cancelled" = false;
