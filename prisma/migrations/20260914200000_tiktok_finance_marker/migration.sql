-- Marker for the TikTok settlement-ledger importer (additive).
ALTER TABLE "Settings" ADD COLUMN "tiktokFinanceSyncedThrough" TIMESTAMP(3);
