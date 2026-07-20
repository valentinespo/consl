-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "asin" TEXT,
ADD COLUMN     "batchSize" INTEGER,
ADD COLUMN     "fnsku" TEXT,
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "minMonths" DOUBLE PRECISION DEFAULT 5,
ADD COLUMN     "reorderToMonths" DOUBLE PRECISION DEFAULT 12,
ADD COLUMN     "sellerSku" TEXT;

-- CreateTable
CREATE TABLE "SkuSnapshot" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fbaAvailable" INTEGER NOT NULL DEFAULT 0,
    "fbaInbound" INTEGER NOT NULL DEFAULT 0,
    "fbaReserved" INTEGER NOT NULL DEFAULT 0,
    "fbaUnfulfillable" INTEGER NOT NULL DEFAULT 0,
    "fbaTotal" INTEGER NOT NULL DEFAULT 0,
    "units30d" INTEGER NOT NULL DEFAULT 0,
    "units90d" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SkuSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkuSnapshot_productId_capturedAt_idx" ON "SkuSnapshot"("productId", "capturedAt");

-- AddForeignKey
ALTER TABLE "SkuSnapshot" ADD CONSTRAINT "SkuSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
