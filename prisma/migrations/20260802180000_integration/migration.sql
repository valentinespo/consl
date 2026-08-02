-- Per-tenant external-platform connections (Amazon/Shopify/TikTok). Additive: new table only.
-- The seller's OAuth refresh token is stored ENCRYPTED (refreshTokenEnc); the app's own OAuth
-- client id/secret stay in env. One connection per (org, provider).
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "refreshTokenEnc" TEXT,
    "sellerId" TEXT,
    "marketplaceId" TEXT,
    "region" TEXT,
    "scope" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Integration_orgId_provider_key" ON "Integration"("orgId", "provider");

ALTER TABLE "Integration" ADD CONSTRAINT "Integration_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
