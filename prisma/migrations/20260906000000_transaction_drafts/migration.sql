-- Transaction drafts: an invoice being written up, kept off the books until completed.
ALTER TABLE "TransactionInvoice" ADD COLUMN "draft" BOOLEAN NOT NULL DEFAULT false,
                                 ADD COLUMN "draftLines" JSONB;
