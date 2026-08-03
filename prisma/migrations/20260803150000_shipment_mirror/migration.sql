-- Single-count plan, Migration B: the inbound-shipment mirror + movement linking. Additive only.

ALTER TABLE "Integration" ADD COLUMN "reconcileSince" TIMESTAMP(3);
ALTER TABLE "Integration" ADD COLUMN "shipmentsSyncedThrough" TIMESTAMP(3);
ALTER TABLE "Integration" ADD COLUMN "shipmentSyncStatus" TEXT;

ALTER TABLE "StockMovement" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';

CREATE TABLE "InboundShipment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "confirmationId" TEXT,
    "name" TEXT,
    "extStatus" TEXT NOT NULL,
    "destination" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'SELLER',
    "marketplaceId" TEXT,
    "historical" BOOLEAN NOT NULL DEFAULT false,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "extCreatedAt" TIMESTAMP(3),
    "extUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InboundShipment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InboundShipment_orgId_platform_externalId_key" ON "InboundShipment"("orgId", "platform", "externalId");
ALTER TABLE "InboundShipment" ADD CONSTRAINT "InboundShipment_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InboundShipmentLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "sellerSku" TEXT NOT NULL,
    "productId" TEXT,
    "qtyShipped" DOUBLE PRECISION NOT NULL,
    "qtyReceived" DOUBLE PRECISION,
    CONSTRAINT "InboundShipmentLine_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "InboundShipmentLine" ADD CONSTRAINT "InboundShipmentLine_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundShipmentLine" ADD CONSTRAINT "InboundShipmentLine_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "InboundShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundShipmentLine" ADD CONSTRAINT "InboundShipmentLine_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MovementShipmentLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "MovementShipmentLink_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MovementShipmentLink_movementId_idx" ON "MovementShipmentLink"("movementId");
CREATE INDEX "MovementShipmentLink_shipmentId_idx" ON "MovementShipmentLink"("shipmentId");
ALTER TABLE "MovementShipmentLink" ADD CONSTRAINT "MovementShipmentLink_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MovementShipmentLink" ADD CONSTRAINT "MovementShipmentLink_movementId_fkey"
    FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MovementShipmentLink" ADD CONSTRAINT "MovementShipmentLink_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "InboundShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
