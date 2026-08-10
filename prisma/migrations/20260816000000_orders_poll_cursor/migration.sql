-- Forward cursor for the near-real-time Amazon Orders API poll.
ALTER TABLE "Settings" ADD COLUMN "ordersPollCursor" TEXT;
