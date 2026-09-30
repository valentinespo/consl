-- Sales tax is never revenue: the buyer pays it for the state, and on Amazon and TikTok the
-- marketplace pays it over itself. Every tax line moves out of Sales (and tax handed back out of
-- Refunds) into Taxes, where it cancels out, so Sales is what the goods and shipping sold for.
-- Profit doesn't change. The importers write new rows the same way (lib/finances.ts,
-- lib/shopify-finances.ts); TikTok already did.

-- Amazon: VAT the marketplace withheld, which the old importer didn't recognise as withheld.
UPDATE "FinanceEvent" SET "group" = 'taxes', type = 'TaxWithheld:' || type
WHERE channel = 'AMAZON' AND "group" = 'sales' AND type LIKE 'MarketplaceFacilitator%';

-- Amazon: the tax the buyer paid (on the product, shipping, gift wrap; MCF orders too).
UPDATE "FinanceEvent" SET "group" = 'taxes'
WHERE channel = 'AMAZON' AND "group" = 'sales' AND type ILIKE '%tax%';

-- Amazon: tax handed back on refunds, chargebacks and A-to-z claims, and the facilitator's matching
-- return. A bare "Tax" is also what Amazon calls the tax it charges on its own fees: that one comes
-- back to the seller (a positive amount) and stays with the refund, as the importer now files it.
UPDATE "FinanceEvent" SET "group" = 'taxes', type = split_part(type, ':', 1) || ':TaxWithheld'
WHERE channel = 'AMAZON' AND "group" = 'refunds' AND split_part(type, ':', 2) LIKE 'MarketplaceFacilitator%';

UPDATE "FinanceEvent" SET "group" = 'taxes'
WHERE channel = 'AMAZON' AND "group" = 'refunds'
  AND split_part(type, ':', 1) IN ('Refund', 'GuaranteeClaim', 'Chargeback')
  AND (split_part(type, ':', 2) IN ('TaxWithheld', 'ShippingTax', 'GiftwrapTax', 'GiftWrapTax')
       OR (split_part(type, ':', 2) = 'Tax' AND amount < 0));

-- Shopify: tax, duties and collected fees, and tax handed back on refunds.
UPDATE "FinanceEvent" SET "group" = 'taxes'
WHERE channel = 'SHOPIFY'
  AND (("group" = 'sales' AND type IN ('Tax collected', 'Duties collected', 'Additional fees collected'))
    OR ("group" = 'refunds' AND type = 'Refund:Tax collected'));
