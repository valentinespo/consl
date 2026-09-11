-- Merchant-fulfilled Amazon orders: the ship-from place Amazon's live order record names (a
-- supply-source id, else the address), so it can be mapped to a facility; and the cursor of the
-- background walk that reads it for the whole history.
ALTER TABLE "SalesOrder" ADD COLUMN "shipFromKey" TEXT, ADD COLUMN "shipFromLabel" TEXT;
CREATE INDEX "SalesOrder_orgId_shipFromKey_idx" ON "SalesOrder"("orgId", "shipFromKey");
ALTER TABLE "Settings" ADD COLUMN "mfnShipFromCursor" TEXT;
