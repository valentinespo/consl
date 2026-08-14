-- Amazon order provenance flags: MCF (fulfilled for another channel) and replacement orders.
ALTER TABLE "SalesOrder" ADD COLUMN "mcf" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SalesOrder" ADD COLUMN "replacement" BOOLEAN NOT NULL DEFAULT false;
