-- AlterTable
ALTER TABLE "LotDocument" ADD COLUMN     "purchaseInvoiceId" TEXT,
ADD COLUMN     "transactionInvoiceId" TEXT,
ALTER COLUMN "lotId" DROP NOT NULL,
ALTER COLUMN "label" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "LotDocument_transactionInvoiceId_idx" ON "LotDocument"("transactionInvoiceId");

-- CreateIndex
CREATE INDEX "LotDocument_purchaseInvoiceId_idx" ON "LotDocument"("purchaseInvoiceId");

-- AddForeignKey
ALTER TABLE "LotDocument" ADD CONSTRAINT "LotDocument_transactionInvoiceId_fkey" FOREIGN KEY ("transactionInvoiceId") REFERENCES "TransactionInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotDocument" ADD CONSTRAINT "LotDocument_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
