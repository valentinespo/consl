-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncRun" TEXT,
ADD COLUMN     "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "syncHour" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "syncMinute" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "syncTz" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';
