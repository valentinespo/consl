-- Ad platform invoices from the billing feed (Amazon Ads), and when the list was last read. Additive.
CREATE TABLE "AdInvoice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fromDay" TEXT,
    "toDay" TEXT,
    "invoiceDay" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "baseAmount" DOUBLE PRECISION,
    "paymentMethod" TEXT,
    "balancePaid" DOUBLE PRECISION,
    "programs" JSONB,
    "detailAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdInvoice_orgId_provider_externalId_key" ON "AdInvoice"("orgId", "provider", "externalId");
CREATE INDEX "AdInvoice_orgId_provider_toDay_idx" ON "AdInvoice"("orgId", "provider", "toDay");

ALTER TABLE "AdInvoice" ADD CONSTRAINT "AdInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Settings" ADD COLUMN "amazonAdsInvoicesSyncedAt" TIMESTAMP(3);
