-- Where each channel's refresh has read up to, so a refresh after any pause (a disconnect, a
-- server that was down) resumes from there instead of a fixed few-day window.
ALTER TABLE "Settings" ADD COLUMN "shopifySyncedThrough" TIMESTAMP(3), ADD COLUMN "tiktokSyncedThrough" TIMESTAMP(3), ADD COLUMN "amazonReportSyncedThrough" TIMESTAMP(3);
