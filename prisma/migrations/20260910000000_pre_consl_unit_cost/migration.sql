-- Pre-consl average cost per product: prices sales that predate the product's first FIFO layer.
ALTER TABLE "Product" ADD COLUMN "preConslUnitCost" DOUBLE PRECISION;
