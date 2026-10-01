-- The tax a store still has to pay the state itself is "Tax owed" (was "Tax remitted": it hasn't
-- been paid when the order lands). The Shopify importer writes the new names (shopifyFinance 4);
-- this renames what a re-read can't reach — orders older than the store lets consl read again, and
-- rows that were never imported from Shopify (a seeded demo). Names only: no amount moves.
UPDATE "FinanceEvent" SET type = CASE type
    WHEN 'Tax remitted' THEN 'Tax owed'
    WHEN 'Duties remitted' THEN 'Duties owed'
    WHEN 'Additional fees remitted' THEN 'Additional fees owed'
  END
WHERE channel = 'SHOPIFY' AND type IN ('Tax remitted', 'Duties remitted', 'Additional fees remitted');
