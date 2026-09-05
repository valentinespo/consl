-- Finance ledger: platform transaction identity + payout status (Amazon Finances API v2024-06-19),
-- and each channel's own calendar on the connection.
ALTER TABLE "FinanceEvent" ADD COLUMN "txId" TEXT,
                           ADD COLUMN "status" TEXT,
                           ADD COLUMN "releasedAt" TIMESTAMP(3);
CREATE INDEX "FinanceEvent_orgId_channel_txId_idx" ON "FinanceEvent"("orgId", "channel", "txId");
ALTER TABLE "Integration" ADD COLUMN "timezone" TEXT;
