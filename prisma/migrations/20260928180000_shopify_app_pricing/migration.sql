-- Shopify App Pricing: the plan a Shopify-billed company's store holds, mirrored from Shopify.
ALTER TABLE "Organization" ADD COLUMN "shopifyPlanStatus" TEXT;
ALTER TABLE "Organization" ADD COLUMN "shopifyPlanHandle" TEXT;
ALTER TABLE "Organization" ADD COLUMN "shopifyPlanPrice" DOUBLE PRECISION;
ALTER TABLE "Organization" ADD COLUMN "shopifyTrialEndsAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "shopifyPeriodEnd" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "shopifyPlanTest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "shopifyShopGid" TEXT;
ALTER TABLE "Organization" ADD COLUMN "shopifyShopDomain" TEXT;
ALTER TABLE "Organization" ADD COLUMN "shopifyBillingAt" TIMESTAMP(3);

-- Every company connected to Shopify before this point that never chose the public app went
-- through the private (custom) app: name that explicitly, so the default can become the public
-- app for everyone connecting from now on.
UPDATE "Settings" SET "shopifyApp" = 'custom'
WHERE "shopifyApp" IS NULL
  AND "orgId" IN (SELECT "orgId" FROM "Integration" WHERE provider = 'shopify');
