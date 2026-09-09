-- Custom order fees: rules that attach a cost to every matching order, fees written by hand, and
-- a manual fulfilled-at override per order (the imported label is kept).
ALTER TABLE "SalesOrder" ADD COLUMN "fulfillmentOverride" TEXT;

CREATE TABLE "OrderFeeRule" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "channel" TEXT,
  "source" TEXT,
  "fulfilledAt" TEXT,
  "tag" TEXT,
  "appliesToPast" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderFeeRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderFeeRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OrderFeeRule_orgId_idx" ON "OrderFeeRule"("orgId");

CREATE TABLE "OrderFee" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "ruleId" TEXT,
  "name" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderFee_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderFee_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderFee_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderFee_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "OrderFeeRule"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OrderFee_orgId_orderId_idx" ON "OrderFee"("orgId", "orderId");
CREATE INDEX "OrderFee_ruleId_idx" ON "OrderFee"("ruleId");
