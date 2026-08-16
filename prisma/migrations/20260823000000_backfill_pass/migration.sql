-- Track the order-backfill pass so every connection gets one automatic verification re-walk.
ALTER TABLE "Settings" ADD COLUMN "ordersBackfillPass" INTEGER NOT NULL DEFAULT 0;
