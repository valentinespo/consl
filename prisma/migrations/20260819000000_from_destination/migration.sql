-- Stock coming BACK from a sales channel (e.g. an Amazon removal order into your own warehouse).
-- Additive only.
ALTER TABLE "StockMovement" ADD COLUMN "fromDestination" TEXT;
