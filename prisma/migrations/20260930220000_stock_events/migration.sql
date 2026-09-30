-- Units that leave a channel's stock without a sale (removal orders, destroyed, lost, lost on the
-- way in, reimbursed) or come back (found, credited back, customer returns), read from the
-- channel's reports; and a per-order switch to leave an order's cost of goods out when its units
-- are already costed that way.
CREATE TABLE "StockEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "detail" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockEvent_orgId_channel_at_idx" ON "StockEvent"("orgId", "channel", "at");
CREATE INDEX "StockEvent_orgId_source_at_idx" ON "StockEvent"("orgId", "source", "at");
ALTER TABLE "StockEvent" ADD CONSTRAINT "StockEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalesOrder" ADD COLUMN "cogsVoided" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Settings" ADD COLUMN "amazonStockEventsBackfilledAt" TIMESTAMP(3);
ALTER TABLE "Settings" ADD COLUMN "amazonStockEventsSyncedAt" TIMESTAMP(3);
