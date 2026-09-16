-- The discovery call's real appointment time and join link, looked up from Calendly's API.
ALTER TABLE "AccessApplication" ADD COLUMN "callScheduledAt" TIMESTAMP(3);
ALTER TABLE "AccessApplication" ADD COLUMN "callJoinUrl" TEXT;
