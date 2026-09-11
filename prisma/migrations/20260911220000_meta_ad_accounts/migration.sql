-- Meta Ads: one row per linked ad account (a connection pass grants the ad accounts the person
-- ticks in Meta's dialog; several passes can link accounts from several business portfolios).
CREATE TABLE "MetaAdAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountNumber" TEXT,
    "name" TEXT NOT NULL,
    "currency" TEXT,
    "timezone" TEXT,
    "businessId" TEXT,
    "businessName" TEXT,
    "accessTokenEnc" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "syncedThrough" TIMESTAMP(3),
    "since" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaAdAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaAdAccount_orgId_accountId_key" ON "MetaAdAccount"("orgId", "accountId");

ALTER TABLE "MetaAdAccount" ADD CONSTRAINT "MetaAdAccount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
