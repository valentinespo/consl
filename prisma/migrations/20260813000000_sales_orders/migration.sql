-- Orders pulled from connected channels: the raw material for velocity and profit.
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT,
    "sourceLabel" TEXT,
    "status" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "fulfillment" TEXT,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesOrder_orgId_channel_externalId_key" ON "SalesOrder"("orgId", "channel", "externalId");
CREATE INDEX "SalesOrder_orgId_channel_orderedAt_idx" ON "SalesOrder"("orgId", "channel", "orderedAt");
CREATE INDEX "SalesOrder_orgId_source_idx" ON "SalesOrder"("orgId", "source");

CREATE TABLE "SalesOrderLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesOrderLine_orgId_productId_idx" ON "SalesOrderLine"("orgId", "productId");
CREATE INDEX "SalesOrderLine_orderId_idx" ON "SalesOrderLine"("orderId");

ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Order sources to drop from Shopify totals (channel-mirrored orders, e.g. TikTok via Shopify).
ALTER TABLE "Settings" ADD COLUMN "excludedShopifySources" TEXT[] DEFAULT ARRAY[]::TEXT[];
