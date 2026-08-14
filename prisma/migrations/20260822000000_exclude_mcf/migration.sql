-- Toggle to drop Amazon MCF orders from totals once another channel carries the sale.
ALTER TABLE "Settings" ADD COLUMN "excludeMcfOrders" BOOLEAN NOT NULL DEFAULT false;
