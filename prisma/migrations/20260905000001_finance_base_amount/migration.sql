-- Multi-marketplace money: native amount + the same in the company's currency; cached FX rates.
ALTER TABLE "FinanceEvent" ADD COLUMN "baseAmount" DOUBLE PRECISION, ADD COLUMN "marketplaceId" TEXT;
CREATE TABLE "FxRate" (
  "id" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "base" TEXT NOT NULL,
  "quote" TEXT NOT NULL,
  "rate" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FxRate_day_base_quote_key" ON "FxRate"("day", "base", "quote");
-- Every row imported so far came through a single-marketplace filter in the company's own
-- currency, so its base amount is the amount itself.
UPDATE "FinanceEvent" SET "baseAmount" = amount WHERE "baseAmount" IS NULL;
