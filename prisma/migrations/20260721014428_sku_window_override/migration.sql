-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "excludeDays" INTEGER,
ADD COLUMN     "windowDays" INTEGER;

-- AlterTable
ALTER TABLE "SkuSnapshot" ADD COLUMN     "dailySales" JSONB,
ADD COLUMN     "salesEnd" TIMESTAMP(3);
