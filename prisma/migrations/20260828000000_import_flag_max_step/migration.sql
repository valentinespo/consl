-- Import-created products remember their origin so unmapping can clean them up while unused.
ALTER TABLE "Product" ADD COLUMN "importedFromListing" BOOLEAN NOT NULL DEFAULT false;

-- The wizard's progress rail: steps up to the furthest ever reached stay revisitable.
ALTER TABLE "Organization" ADD COLUMN "onboardingMaxStep" INTEGER NOT NULL DEFAULT 0;
UPDATE "Organization" SET "onboardingMaxStep" = "onboardingStep";
