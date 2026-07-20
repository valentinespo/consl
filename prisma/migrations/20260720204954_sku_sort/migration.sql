-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "sortIndex" INTEGER;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "sortMode" TEXT NOT NULL DEFAULT 'sales';
