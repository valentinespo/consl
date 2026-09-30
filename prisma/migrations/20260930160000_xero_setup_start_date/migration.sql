-- The Xero export starts on a day (a partial first month is allowed), and remembers the accounts
-- consl created in Xero (the only same-name accounts a retried save may reuse).
ALTER TABLE "XeroSetup" ADD COLUMN "startDate" TEXT;
ALTER TABLE "XeroSetup" ADD COLUMN "createdAccountIds" JSONB NOT NULL DEFAULT '[]';
