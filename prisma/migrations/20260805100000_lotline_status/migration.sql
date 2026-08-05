-- Per-SKU lifecycle: status/payment/finished metadata move from the lot to each lot line.
-- Additive; every line inherits its lot's current values so nothing changes meaning. The lot's
-- own columns stay as a derived cache (FINISHED/PAID only when every line is).

ALTER TABLE "LotLine" ADD COLUMN "status" "LotStatus" NOT NULL DEFAULT 'IN_PRODUCTION';
ALTER TABLE "LotLine" ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'DUE';
ALTER TABLE "LotLine" ADD COLUMN "finishedAt" TIMESTAMP(3);
ALTER TABLE "LotLine" ADD COLUMN "expiryAt" TIMESTAMP(3);
ALTER TABLE "LotLine" ADD COLUMN "batchNr" TEXT;

UPDATE "LotLine" ll
SET "status" = l."status",
    "paymentStatus" = l."paymentStatus",
    "finishedAt" = l."finishedAt",
    "expiryAt" = l."expiryAt",
    "batchNr" = l."batchNr"
FROM "Lot" l
WHERE ll."lotId" = l."id";
