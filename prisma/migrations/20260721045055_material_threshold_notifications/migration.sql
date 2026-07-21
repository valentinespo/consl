-- AlterTable
ALTER TABLE "MaterialType" ADD COLUMN     "lowStockThreshold" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "DismissedNotification" (
    "key" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DismissedNotification_pkey" PRIMARY KEY ("key")
);
