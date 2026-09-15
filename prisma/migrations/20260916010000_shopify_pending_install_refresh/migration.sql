-- Expiring offline tokens for parked Shopify installs: the access token lasts an hour, the
-- refresh token mints the next one when the store is attached to a company.
ALTER TABLE "ShopifyPendingInstall" ADD COLUMN "refreshTokenEnc" TEXT;
ALTER TABLE "ShopifyPendingInstall" ADD COLUMN "accessTokenExpiresAt" TIMESTAMP(3);
