-- Facility merge (additive): a place pointed at a facility by hand, the platform behind each
-- channel-stock row, and the facility's chosen stock source.
ALTER TABLE "ChannelLocation" ADD COLUMN "mappedManually" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChannelStock" ADD COLUMN "channel" TEXT;
UPDATE "ChannelStock" cs SET "channel" = f."channel" FROM "Facility" f WHERE f.id = cs."facilityId" AND cs."channel" IS NULL;
ALTER TABLE "ChannelStock" DROP CONSTRAINT IF EXISTS "ChannelStock_orgId_facilityId_productId_key";
DROP INDEX IF EXISTS "ChannelStock_orgId_facilityId_productId_key";
CREATE UNIQUE INDEX "ChannelStock_orgId_facilityId_productId_channel_key" ON "ChannelStock"("orgId", "facilityId", "productId", "channel");
ALTER TABLE "Facility" ADD COLUMN "stockSource" TEXT;
