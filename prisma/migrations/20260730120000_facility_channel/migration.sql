-- Channel facilities: a connected sales platform (Amazon FBA/AWD, Shopify, TikTok Shop…)
-- materialises as a locked Facility the moment its integration connects. Purely additive.
ALTER TABLE "Facility" ADD COLUMN "channel" TEXT;
ALTER TABLE "Facility" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;
