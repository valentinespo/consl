-- Which Shopify app a company connects through (null = default custom app, "public" = public app).
ALTER TABLE "Settings" ADD COLUMN "shopifyApp" TEXT;
