-- 1) Shopify's "Shop Cash credit": the customer paid part of an order with Shop Cash, which Shopify
--    settles like a gift card. The sale is already counted from the order, so the credit is the
--    payment for it (like the card part): cash, not income. It was counted twice. The importer files
--    new ones (and Shop Cash taken back on a refund) the same way (lib/shopify-finances.ts).
UPDATE "FinanceEvent" SET "group" = 'cash'
WHERE channel = 'SHOPIFY' AND "group" = 'other' AND type ILIKE 'shop cash%';

-- 2) Tax Amazon charged on its own refund fee (VAT on a refund administration fee) sat with the
--    buyers' sales tax, so Taxes didn't net to zero. A refund's tax with no facilitator tax behind
--    it is a fee's tax: it goes back with the refund, where the importer files it.
UPDATE "FinanceEvent" fe SET "group" = 'refunds'
WHERE fe.channel = 'AMAZON' AND fe."group" = 'taxes'
  AND fe.type ~ '^(Refund|GuaranteeClaim|Chargeback):(Tax|ShippingTax|GiftwrapTax|GiftWrapTax)$'
  AND NOT EXISTS (
    SELECT 1 FROM "FinanceEvent" w
    WHERE w."orgId" = fe."orgId" AND w.channel = 'AMAZON' AND w."txId" = fe."txId" AND w."group" = 'taxes' AND w.type LIKE '%TaxWithheld%');
