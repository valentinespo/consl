-- The platform's own customer id on an order (no name, no email): what the LTV view groups by. Additive.
ALTER TABLE "SalesOrder" ADD COLUMN "customerId" TEXT;
CREATE INDEX "SalesOrder_orgId_channel_customerId_idx" ON "SalesOrder"("orgId", "channel", "customerId");
