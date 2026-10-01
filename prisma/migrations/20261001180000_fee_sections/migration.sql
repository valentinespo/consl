-- Amazon fees in the section they belong in (the same rules as amazonSection in lib/finances.ts,
-- which files new rows this way). Fulfillment = everything Amazon charges to move stock: the
-- shipping and gift wrap it charges back on an order (were under Referral fees), getting stock in
-- (inbound transportation, placement), AWD's processing and transport, removals and disposals, and
-- fulfillment-fee corrections (were under Other). AWD storage joins FBA storage. Vine is
-- marketing. Reimbursements stay under Other. Only sections change: no amount, no total, no profit.
UPDATE "FinanceEvent" SET "group" = CASE
    WHEN lower(regexp_replace(type, '^MCF:', '')) LIKE '%vine%' THEN 'advertising'
    WHEN lower(regexp_replace(type, '^MCF:', '')) LIKE '%chargeback' THEN 'fba_fees'
    WHEN lower(type) ~ '(missing|reimburs|clawback|refund|replacement)' THEN "group"
    WHEN lower(type) LIKE '%storage%' AND lower(type) NOT LIKE '%transport%' THEN 'storage_fees'
    WHEN lower(type) ~ '(inbound|removal|disposal|upstream|perunitfulfillment)' THEN 'fba_fees'
    ELSE "group"
  END
WHERE channel = 'AMAZON' AND "group" IN ('other', 'referral_fees');
