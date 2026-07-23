-- AlterTable
ALTER TABLE "DismissedNotification" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "InventoryValueSnapshot" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "Lot" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "LotDocument" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "MaterialType" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseInvoice" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "SkuSnapshot" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "TransactionInvoice" ADD COLUMN     "orgId" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuSnapshot" ADD CONSTRAINT "SkuSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DismissedNotification" ADD CONSTRAINT "DismissedNotification_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryValueSnapshot" ADD CONSTRAINT "InventoryValueSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialType" ADD CONSTRAINT "MaterialType_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotDocument" ADD CONSTRAINT "LotDocument_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionInvoice" ADD CONSTRAINT "TransactionInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
