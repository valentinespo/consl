/*
  Warnings:

  - You are about to drop the column `leadTimeDays` on the `Product` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "leadTimeDays",
ADD COLUMN     "leadMonths" DOUBLE PRECISION,
ALTER COLUMN "minMonths" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SkuSnapshot" ADD COLUMN     "inStock" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "salesDays10" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesDays30" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesDays90" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "defaultMinMonths" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "defaultLeadMonths" DOUBLE PRECISION NOT NULL DEFAULT 4.5,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);
