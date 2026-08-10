-- Split channel-held stock value out per channel in the daily snapshot.
ALTER TABLE "InventoryValueSnapshot" ADD COLUMN "shopify" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "InventoryValueSnapshot" ADD COLUMN "tiktok" DOUBLE PRECISION NOT NULL DEFAULT 0;
