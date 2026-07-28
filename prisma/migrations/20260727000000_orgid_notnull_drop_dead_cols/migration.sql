-- Lock orgId NOT NULL at the DB level, and drop the 4 dead tea-shaped cost columns.
--
-- orgId stays `String?` in schema.prisma on purpose (so the auto-stamping client can omit it from
-- create() inputs); this migration makes the *database* column NOT NULL as a defense-in-depth safety
-- net. See the header comment in prisma/schema.prisma. Hand-authored, not generated.

-- 1. Backfill any legacy NULL orgId. New rows are always stamped (lib/db.ts stampData, top-level and
--    nested), so a NULL can only be a pre-multitenancy legacy row. Children inherit their parent's
--    org (correct even once multiple tenants exist); the remaining orphans go to the founding org.

-- 1a0. Three tables hold per-org aggregate/config state under an orgId-scoped UNIQUE constraint
--      (InventoryValueSnapshot: orgId+day, Settings: orgId, DismissedNotification: orgId+key). Their
--      legacy NULL rows are stale versions the app already superseded with org-tagged ones, so
--      assigning them to the founding org would collide. They are regenerable, so drop them.
DELETE FROM "InventoryValueSnapshot" WHERE "orgId" IS NULL;
DELETE FROM "Settings" WHERE "orgId" IS NULL;
DELETE FROM "DismissedNotification" WHERE "orgId" IS NULL;

-- 1a. Children from their parents. Order matters: LotLine before LotMaterial.
UPDATE "PurchaseOrderLine" c SET "orgId" = p."orgId"
  FROM "PurchaseOrder" p WHERE c."poId" = p."id" AND c."orgId" IS NULL;
UPDATE "LotLine" c SET "orgId" = p."orgId"
  FROM "Lot" p WHERE c."lotId" = p."id" AND c."orgId" IS NULL;
UPDATE "LotMaterial" c SET "orgId" = ll."orgId"
  FROM "LotLine" ll WHERE c."lotLineId" = ll."id" AND c."orgId" IS NULL;
UPDATE "LotDocument" d SET "orgId" = COALESCE(
    (SELECT "orgId" FROM "Lot" WHERE "id" = d."lotId"),
    (SELECT "orgId" FROM "TransactionInvoice" WHERE "id" = d."transactionInvoiceId"),
    (SELECT "orgId" FROM "PurchaseInvoice" WHERE "id" = d."purchaseInvoiceId")
  ) WHERE d."orgId" IS NULL;

-- 1b. Any remaining orphans (standalone tables, or a child whose parent was itself null) → the
--     founding (oldest) organization. If there are no organizations at all, nothing is assigned and
--     the NOT NULL below will (correctly) fail rather than silently invent a tenant.
DO $$
DECLARE founding TEXT;
BEGIN
  SELECT "id" INTO founding FROM "Organization" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1;
  IF founding IS NOT NULL THEN
    UPDATE "Facility"               SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "Supplier"               SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "Product"                SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "SkuSnapshot"            SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "MaterialType"           SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "PurchaseInvoice"        SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "Purchase"               SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "Lot"                    SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "LotDocument"            SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "PurchaseOrder"          SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "TransactionInvoice"     SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "Transaction"            SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "LotLine"                SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "LotMaterial"            SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "PurchaseOrderLine"      SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "StockMovement"          SET "orgId" = founding WHERE "orgId" IS NULL;
    UPDATE "Invite"                 SET "orgId" = founding WHERE "orgId" IS NULL;
  END IF;
END $$;

-- 2. Lock NOT NULL on every tenant table's orgId.
ALTER TABLE "Facility"               ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Supplier"               ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Product"                ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "SkuSnapshot"            ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "DismissedNotification"  ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "InventoryValueSnapshot" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Settings"               ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "MaterialType"           ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "PurchaseInvoice"        ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Purchase"               ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Lot"                    ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "LotDocument"            ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "PurchaseOrder"          ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "TransactionInvoice"     ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Transaction"            ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "LotLine"                ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "LotMaterial"            ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "PurchaseOrderLine"      ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "StockMovement"          ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Invite"                 ALTER COLUMN "orgId" SET NOT NULL;

-- 3. Drop the 4 dead tea-shaped cost columns (superseded by materialCostsJson / transactionCostsJson;
--    nothing in the app reads or writes them).
ALTER TABLE "LotLine" DROP COLUMN "teaCostPerUnit";
ALTER TABLE "LotLine" DROP COLUMN "otherCostPerUnit";
ALTER TABLE "LotLine" DROP COLUMN "teabagCostPerUnit";
ALTER TABLE "LotLine" DROP COLUMN "pouchCostPerUnit";
