-- Order number, fulfilled-at label, and the Amazon lifetime-backfill cursor.
ALTER TABLE "SalesOrder" ADD COLUMN "orderNumber" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "fulfillmentLabel" TEXT;
ALTER TABLE "Settings" ADD COLUMN "ordersBackfillCursor" TEXT;
