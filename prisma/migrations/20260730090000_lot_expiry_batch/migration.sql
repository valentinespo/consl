-- Finished-lot metadata: expiry date and production batch number, entered when a lot is
-- marked FINISHED (nullable, purely additive).
ALTER TABLE "Lot" ADD COLUMN "expiryAt" TIMESTAMP(3);
ALTER TABLE "Lot" ADD COLUMN "batchNr" TEXT;
