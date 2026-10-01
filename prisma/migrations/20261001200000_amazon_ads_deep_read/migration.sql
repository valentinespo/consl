-- When Amazon Ads' last 90 days of daily spend were last asked again (once a day): Amazon lowers a
-- day's spend for weeks after it happened; the passes in between re-read only the last few days.
ALTER TABLE "Settings" ADD COLUMN "amazonAdsDeepReadAt" TIMESTAMP(3);
