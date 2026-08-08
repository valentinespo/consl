-- Facilities can now be materialised from an integration's own places (Shopify locations).
-- Additive: `externalId` is the platform's id for the place, so a rename over there updates this
-- row instead of creating a duplicate; `inactive` retires a facility whose place disappeared
-- without ever deleting it (it may carry lots, purchases and movements).

ALTER TABLE "Facility" ADD COLUMN "externalId" TEXT;
ALTER TABLE "Facility" ADD COLUMN "inactive" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Facility_orgId_externalId_idx" ON "Facility"("orgId", "externalId");
