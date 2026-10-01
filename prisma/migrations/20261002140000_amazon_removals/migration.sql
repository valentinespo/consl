-- Amazon's removal orders (stock pulled out of Amazon), from its removal order report; and the
-- mark on their copies in Amazon's order feed, which lists them like MCF orders: not a sale.
CREATE TABLE "AmazonRemoval" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "removalId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT,
    "lines" JSONB NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AmazonRemoval_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AmazonRemoval_orgId_removalId_key" ON "AmazonRemoval"("orgId", "removalId");
CREATE INDEX "AmazonRemoval_orgId_requestedAt_idx" ON "AmazonRemoval"("orgId", "requestedAt");
ALTER TABLE "AmazonRemoval" ADD CONSTRAINT "AmazonRemoval_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalesOrder" ADD COLUMN "removal" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Settings" ADD COLUMN "amazonRemovalsSyncedAt" TIMESTAMP(3);
ALTER TABLE "Settings" ADD COLUMN "amazonRemovalsThrough" TIMESTAMP(3);
