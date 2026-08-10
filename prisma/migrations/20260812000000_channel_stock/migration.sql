-- Finished units a sales channel reports holding, per SKU × channel facility.
-- Amazon stays on SkuSnapshot (richer FBA/AWD split); this covers Shopify + TikTok, which report
-- a single quantity per warehouse.
CREATE TABLE "ChannelStock" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelStock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelStock_orgId_facilityId_productId_key" ON "ChannelStock"("orgId", "facilityId", "productId");
CREATE INDEX "ChannelStock_orgId_productId_idx" ON "ChannelStock"("orgId", "productId");
CREATE INDEX "ChannelStock_facilityId_idx" ON "ChannelStock"("facilityId");

ALTER TABLE "ChannelStock" ADD CONSTRAINT "ChannelStock_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelStock" ADD CONSTRAINT "ChannelStock_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelStock" ADD CONSTRAINT "ChannelStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
