-- Amazon Ads: when the invoice feed was last listed in full, and the ad profile's currency. Additive.
ALTER TABLE "Settings" ADD COLUMN "amazonAdsInvoicesFullAt" TIMESTAMP(3);
ALTER TABLE "Integration" ADD COLUMN "adsCurrency" TEXT;
