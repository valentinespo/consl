-- When consl added PayPal's standard fee as a rule for regular-PayPal Shopify orders (once).
ALTER TABLE "Settings" ADD COLUMN "paypalFeeRuleAt" TIMESTAMP(3);
