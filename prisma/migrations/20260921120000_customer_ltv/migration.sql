ALTER TABLE "Settings"
  ADD COLUMN "ltvExcludedChannels" JSONB,
  ADD COLUMN "ltvIncludeFreeOrders" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ltvCohortAnchor" TEXT NOT NULL DEFAULT 'included',
  ADD COLUMN "shopifyLtvState" JSONB,
  ADD COLUMN "shopifyLtvLeaseUntil" TIMESTAMP(3);

ALTER TABLE "SalesOrder" ADD COLUMN "ltvData" JSONB;
