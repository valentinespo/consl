-- Meta Ads connection: which P&L channel its spend counts against, and the daily-spend markers.
ALTER TABLE "Integration" ADD COLUMN "adsChannel" TEXT;
ALTER TABLE "Settings" ADD COLUMN "metaAdsSyncedThrough" TIMESTAMP(3), ADD COLUMN "metaAdsSince" TIMESTAMP(3);
