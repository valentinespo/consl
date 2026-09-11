-- When the Amazon ledger walks (history backfill, importer re-read) last made progress, so the
-- P&L can show how far they are and say when one has stalled instead of sitting on a notice.
ALTER TABLE "Settings" ADD COLUMN "financeProgressAt" TIMESTAMP(3);
