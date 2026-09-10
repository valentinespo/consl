-- Every place a connected channel can ship from, as the platform lists it — so an order's
-- location or warehouse id resolves from the platform's own record, never a guess.
CREATE TABLE "ChannelLocation" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "facilityId" TEXT,
  "amazonMirror" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelLocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChannelLocation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelLocation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChannelLocation_orgId_channel_externalId_key" ON "ChannelLocation"("orgId", "channel", "externalId");
