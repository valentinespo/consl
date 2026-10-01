-- Amazon's MCF fee credit (money handed back on MCF orders) nets against the MCF fulfillment it
-- credits: Fulfillment fees, not Other. And Amazon's coupon fee (charged per coupon used) is the cost
-- of the discount: it joins Discounts under Sales. Amazon named that fee CouponPayment first and
-- SellerPoweredCoupon later — one fee, so the old name takes the new one and they read as one line.
-- The importer files new rows the same way (amazonSection in lib/finances.ts). Profit doesn't change.
UPDATE "FinanceEvent" SET "group" = 'fba_fees'
WHERE channel = 'AMAZON' AND "group" = 'other' AND type = 'MCCFCredit';

UPDATE "FinanceEvent" SET "group" = 'sales'
WHERE channel = 'AMAZON' AND "group" = 'other' AND lower(type) LIKE '%coupon%';

UPDATE "FinanceEvent" SET type = 'SellerPoweredCoupon'
WHERE channel = 'AMAZON' AND type = 'CouponPayment';
