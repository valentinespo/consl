-- How each order was paid (the platform's gateway key + the wallet/card detail behind it), fee
-- rules keyed on the payment method and on a period of order dates, the P&L bucket a fee lands
-- in (Payment processing or Custom fees), and percent-plus-fixed rules.
ALTER TABLE "SalesOrder" ADD COLUMN "paymentMethod" TEXT, ADD COLUMN "paymentDetail" TEXT;
CREATE INDEX "SalesOrder_orgId_paymentMethod_idx" ON "SalesOrder"("orgId", "paymentMethod");
ALTER TABLE "OrderFeeRule" ADD COLUMN "paymentMethod" TEXT, ADD COLUMN "bucket" TEXT NOT NULL DEFAULT 'custom_fees', ADD COLUMN "extraFixed" DOUBLE PRECISION, ADD COLUMN "periodFrom" TIMESTAMP(3), ADD COLUMN "periodTo" TIMESTAMP(3);
ALTER TABLE "OrderFee" ADD COLUMN "bucket" TEXT NOT NULL DEFAULT 'custom_fees';
