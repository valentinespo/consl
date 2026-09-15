-- Automatic void rules (additive): what a rule does, and which rule voided an order.
ALTER TABLE "OrderFeeRule" ADD COLUMN "action" TEXT NOT NULL DEFAULT 'fee';
ALTER TABLE "SalesOrder" ADD COLUMN "voidRuleId" TEXT;
CREATE INDEX "SalesOrder_orgId_voidRuleId_idx" ON "SalesOrder"("orgId", "voidRuleId");
