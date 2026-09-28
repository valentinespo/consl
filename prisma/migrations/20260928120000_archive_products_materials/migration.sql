-- Archive: hides a product or material from the catalog and pickers; nothing it holds changes.
ALTER TABLE "Product" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "MaterialType" ADD COLUMN "archivedAt" TIMESTAMP(3);
