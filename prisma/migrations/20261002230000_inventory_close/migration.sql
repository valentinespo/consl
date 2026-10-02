-- A company's stock at the end of each of its days: the channels' units read seconds after
-- midnight, and what the stock was worth then.
CREATE TABLE "InventoryClose" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "counts" JSONB NOT NULL,
    "raw" DOUBLE PRECISION NOT NULL,
    "inProduction" DOUBLE PRECISION NOT NULL,
    "fba" DOUBLE PRECISION NOT NULL,
    "awd" DOUBLE PRECISION NOT NULL,
    "shopify" DOUBLE PRECISION NOT NULL,
    "tiktok" DOUBLE PRECISION NOT NULL,
    "atLocations" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "InventoryClose_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryClose_orgId_day_key" ON "InventoryClose"("orgId", "day");

ALTER TABLE "InventoryClose" ADD CONSTRAINT "InventoryClose_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
