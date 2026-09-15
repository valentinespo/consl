-- What a person decided a Shopify location / TikTok warehouse is (own | merged | mcf | ignored,
-- auto = consl decides), and what the platform last reported there (additive).
ALTER TABLE "ChannelLocation" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "ChannelLocation" ADD COLUMN "reportedUnits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChannelLocation" ADD COLUMN "reportedSkus" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChannelLocation" ADD COLUMN "reportedAt" TIMESTAMP(3);
UPDATE "ChannelLocation" SET "mode" = 'merged' WHERE "mappedManually" = true AND "facilityId" IS NOT NULL;
