-- Credits on orders: money added by hand (a shipping charge the platform doesn't show, a
-- reimbursement). Same table as fees; "type" tells them apart.
ALTER TABLE "OrderFee" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'fee';
