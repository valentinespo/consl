-- How a company's P&L goes to Xero: account per P&L line and channel, balance-sheet accounts, options.
CREATE TABLE "XeroSetup" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '{}',
    "balances" JSONB NOT NULL DEFAULT '{}',
    "sameForAllChannels" BOOLEAN NOT NULL DEFAULT true,
    "tagChannels" BOOLEAN NOT NULL DEFAULT true,
    "trackingCategoryId" TEXT,
    "trackingOptions" JSONB NOT NULL DEFAULT '{}',
    "startMonth" TEXT,
    "savedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XeroSetup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "XeroSetup_orgId_key" ON "XeroSetup"("orgId");

ALTER TABLE "XeroSetup" ADD CONSTRAINT "XeroSetup_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
