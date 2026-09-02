-- The pending-revenue bridge checks per order whether shipment money has posted yet.
CREATE INDEX "FinanceEvent_orgId_orderId_idx" ON "FinanceEvent"("orgId", "orderId");
