-- Amazon's "Debt payment": a card (or another marketplace's balance) topping up an account that ran
-- negative — money moving, never profit. The fee that ran the balance down (a subscription on a
-- marketplace with no sales) stays the cost; booking the top-up as income cancelled it. It joins the
-- reserves under "cash", which no statement line sums. New rows are filed the same way
-- (amazonSection in lib/finances.ts).
UPDATE "FinanceEvent" SET "group" = 'cash'
WHERE channel = 'AMAZON' AND "group" = 'other' AND lower(type) LIKE 'debt%';
