-- Onboarding wizard + day-zero starting-balance layers.
-- Additive / loosening only — safe under a running deploy.

-- Organizations gain onboarding state. Every EXISTING company is backfilled as already onboarded
-- so the wizard only ever gates companies created after this ships.
ALTER TABLE "Organization" ADD COLUMN "onboardedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "onboardingStep" INTEGER NOT NULL DEFAULT 0;
UPDATE "Organization" SET "onboardedAt" = CURRENT_TIMESTAMP;

-- Starting-balance movements: kind OPENING rows have no source facility and carry the
-- operator-entered unit cost of the day-zero FIFO layer they create.
ALTER TABLE "StockMovement" ALTER COLUMN "fromFacilityId" DROP NOT NULL;
ALTER TABLE "StockMovement" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "StockMovement" ADD COLUMN "unitCost" DOUBLE PRECISION;

-- Per-SKU average COG entered during onboarding (stamps the finished-goods opening layers).
ALTER TABLE "Product" ADD COLUMN "openingUnitCost" DOUBLE PRECISION;
