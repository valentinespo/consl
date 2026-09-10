-- Which importer generation wrote each company's ledgers, and the progress of a background
-- re-read when the code's generation is newer — so an importer improvement reaches every company.
ALTER TABLE "Settings" ADD COLUMN "importerVersions" JSONB, ADD COLUMN "financeRewalkCursor" TEXT;
