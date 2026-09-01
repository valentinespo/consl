-- P&L attribution date: order-scoped shipment money lands on the ORDER's purchase instant (how
-- sellers read a daily P&L, and how Sellerise groups); everything else keeps its posted date.
ALTER TABLE "FinanceEvent" ADD COLUMN "eventAt" TIMESTAMP(3);
UPDATE "FinanceEvent" SET "eventAt" = "postedAt";
ALTER TABLE "FinanceEvent" ALTER COLUMN "eventAt" SET NOT NULL;

CREATE INDEX "FinanceEvent_orgId_channel_eventAt_idx" ON "FinanceEvent"("orgId", "channel", "eventAt");
CREATE INDEX "FinanceEvent_orgId_group_eventAt_idx" ON "FinanceEvent"("orgId", "group", "eventAt");
