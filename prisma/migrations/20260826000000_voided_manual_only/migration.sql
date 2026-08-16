-- Voided is manual-only: free units and free samples carry real COG and count normally, and
-- cancelled stands on its own flag. Reset every rule-applied void; keep operator decisions.
UPDATE "SalesOrder" SET "voided" = false WHERE "voided" = true AND "voidedManual" = false;
