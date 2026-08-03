-- Single-count plan, Migration A: the COST and PAYMENT axes + day-one valuation fallback.
-- Purely additive; the cost engine reads none of these, so recompute output is unchanged.

-- Estimate invoices (cost axis) + payment fields (payables only)
ALTER TABLE "TransactionInvoice" ADD COLUMN "isEstimate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TransactionInvoice" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "TransactionInvoice" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "TransactionInvoice" ADD COLUMN "amountPaid" DOUBLE PRECISION;

-- Day-one channel-valuation fallback
ALTER TABLE "Product" ADD COLUMN "standardUnitCost" DOUBLE PRECISION;

-- Provisional share of each day's inventory value (chart annotation)
ALTER TABLE "InventoryValueSnapshot" ADD COLUMN "provisionalValue" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Estimate true-up audit trail
CREATE TABLE "CostRevision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "oldTotal" DOUBLE PRECISION NOT NULL,
    "newTotal" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostRevision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CostRevision" ADD CONSTRAINT "CostRevision_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
