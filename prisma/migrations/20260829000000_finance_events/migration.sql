-- The financial ledger behind the P&L: one row per money movement from a sales channel
-- (Amazon Finances API first). Imports replace whole posted-date windows, so no unique key.
CREATE TABLE "FinanceEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "channel" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "group" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "orderId" TEXT,
    "sku" TEXT,
    "quantity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FinanceEvent" ADD CONSTRAINT "FinanceEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "FinanceEvent_orgId_channel_postedAt_idx" ON "FinanceEvent"("orgId", "channel", "postedAt");
CREATE INDEX "FinanceEvent_orgId_group_postedAt_idx" ON "FinanceEvent"("orgId", "group", "postedAt");

-- Ledger import cursors: forward live sweep + backward history walk.
ALTER TABLE "Settings" ADD COLUMN "financeEventsCursor" TEXT;
ALTER TABLE "Settings" ADD COLUMN "financeBackfillCursor" TEXT;
