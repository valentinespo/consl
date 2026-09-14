-- The exhaustive Amazon order audit: where the live Orders API walk has reached, and whether it is done.
ALTER TABLE "Settings" ADD COLUMN "ordersAuditCursor" TEXT, ADD COLUMN "ordersAuditPass" INTEGER NOT NULL DEFAULT 0;
