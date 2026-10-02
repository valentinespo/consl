-- The Xero setup's custom lines (fees and credits added in consl: sent only when placed) and the
-- saved-but-unpublished draft of the whole setup.
ALTER TABLE "XeroSetup" ADD COLUMN "customLines" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "XeroSetup" ADD COLUMN "draft" JSONB;
ALTER TABLE "XeroSetup" ADD COLUMN "draftSavedAt" TIMESTAMP(3);
