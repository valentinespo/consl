-- Orders newest-first across channels, date filters without a channel, and oldest-order lookups
-- read this instead of sorting every order.
CREATE INDEX "SalesOrder_orgId_orderedAt_idx" ON "SalesOrder"("orgId", "orderedAt");
