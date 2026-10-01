-- Orders can be voided three ways: the whole order, its revenue only, or its cost of goods only;
-- automatic void rules choose which.
ALTER TABLE "SalesOrder" ADD COLUMN "revenueVoided" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrderFeeRule" ADD COLUMN "voidKind" TEXT NOT NULL DEFAULT 'all';
-- Cost-of-goods voids so far were all set by hand: mark them so, so no rule ever overrides them.
UPDATE "SalesOrder" SET "voidedManual" = true WHERE "cogsVoided" = true AND "voidRuleId" IS NULL;
