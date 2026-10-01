-- An Amazon MCF order's reference from whoever sent it ("Shopify #1234 …"), and the channel whose
-- sale it shipped plus that order (lib/mcf-attribution). Nullable: an order not matched yet has none.
ALTER TABLE "SalesOrder" ADD COLUMN "mcfRef" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "mcfChannel" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "mcfOrderId" TEXT;
