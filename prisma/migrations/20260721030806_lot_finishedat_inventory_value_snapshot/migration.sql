-- AlterTable
ALTER TABLE "Lot" ADD COLUMN     "finishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InventoryValueSnapshot" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" DOUBLE PRECISION NOT NULL,
    "inProduction" DOUBLE PRECISION NOT NULL,
    "fba" DOUBLE PRECISION NOT NULL,
    "awd" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "InventoryValueSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryValueSnapshot_day_key" ON "InventoryValueSnapshot"("day");
