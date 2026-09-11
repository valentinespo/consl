-- Amazon Ads connection: the advertising profile (and its account id) the spend is read for, and
-- the markers of the daily-spend import — where it has read up to, and the first day it covers
-- (from which the invoice-based ad rows step aside on the P&L).
ALTER TABLE "Integration" ADD COLUMN "adsProfileId" TEXT, ADD COLUMN "adsAccountId" TEXT;
ALTER TABLE "Settings" ADD COLUMN "amazonAdsSyncedThrough" TIMESTAMP(3), ADD COLUMN "amazonAdsSince" TIMESTAMP(3);
-- Reports requested from Amazon Ads that haven't finished generating yet (Amazon builds them
-- asynchronously): [{ id, adProduct, from, to }], collected on later ticks.
ALTER TABLE "Settings" ADD COLUMN "amazonAdsPendingReports" JSONB;
