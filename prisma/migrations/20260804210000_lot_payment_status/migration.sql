-- Lot payment status (PAID | DUE), independent of production status. Additive, non-breaking.
ALTER TABLE "Lot" ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'DUE';

-- One-time seed of existing data: every finished lot to date has been fully paid, so mark it PAID.
-- In-production lots keep the DUE default. New lots created after this go out DUE until marked paid.
UPDATE "Lot" SET "paymentStatus" = 'PAID' WHERE "status" = 'FINISHED';
