-- What a lost raw material cost (first-in-first-out), written by the cost engine: the P&L books it
-- as cost of goods ("Write-offs").
ALTER TABLE "StockMovement" ADD COLUMN "lossCost" DOUBLE PRECISION;
