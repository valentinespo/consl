-- "Fulfilled at" becomes a real consl facility: the one detected from the platform at import, and
-- the operator's correction. The platform's own label stays on fulfillmentLabel for the record.
-- (fulfillmentOverride, a free-text draft of the correction, is retired — columns stay.)
ALTER TABLE "SalesOrder" ADD COLUMN "fulfillmentFacilityId" TEXT, ADD COLUMN "fulfillmentOverrideFacilityId" TEXT;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_fulfillmentFacilityId_fkey" FOREIGN KEY ("fulfillmentFacilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_fulfillmentOverrideFacilityId_fkey" FOREIGN KEY ("fulfillmentOverrideFacilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "SalesOrder_orgId_fulfillmentFacilityId_idx" ON "SalesOrder"("orgId", "fulfillmentFacilityId");
-- Fee rules key on the facility, not the platform's label.
ALTER TABLE "OrderFeeRule" ADD COLUMN "facilityId" TEXT;
ALTER TABLE "OrderFeeRule" ADD CONSTRAINT "OrderFeeRule_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
