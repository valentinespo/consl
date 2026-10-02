-- One receivable account for every sales channel instead of one per channel.
ALTER TABLE "XeroSetup" ADD COLUMN "sharedReceivable" BOOLEAN NOT NULL DEFAULT false;
