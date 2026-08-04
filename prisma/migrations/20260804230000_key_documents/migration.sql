-- Org-defined key-document labels (e.g. BOL, COA) shown as presence pills on the lots table.
ALTER TABLE "Settings" ADD COLUMN "keyDocuments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Seed existing orgs with the two standard co-packing documents; each org can edit these.
UPDATE "Settings" SET "keyDocuments" = ARRAY['BOL','COA'];
