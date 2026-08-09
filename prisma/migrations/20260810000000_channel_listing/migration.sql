-- The mapping screen's worklist: a snapshot of each connected channel's catalog plus the
-- founder's ignore choices. Mappings themselves stay on Product's per-channel columns.
CREATE TABLE "ChannelListing" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalProductId" TEXT,
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "price" DOUBLE PRECISION,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelListing_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChannelListing_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChannelListing_orgId_channel_externalId_key" ON "ChannelListing"("orgId", "channel", "externalId");
CREATE INDEX "ChannelListing_orgId_channel_ignored_idx" ON "ChannelListing"("orgId", "channel", "ignored");
