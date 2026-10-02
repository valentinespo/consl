-- How Xero's Inventory starts on the start date: matched to consl's stock value (with the
-- difference to adjust) or kept as Xero has it.
ALTER TABLE "XeroSetup" ADD COLUMN "inventoryOpening" JSONB;
