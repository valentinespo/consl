-- An install that started on Shopify's side before anyone was signed in: the store's token waits
-- here until the person signs in or signs up and it is attached to their company.
CREATE TABLE "ShopifyPendingInstall" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "scope" TEXT,
    "claimToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyPendingInstall_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopifyPendingInstall_shop_key" ON "ShopifyPendingInstall"("shop");
CREATE UNIQUE INDEX "ShopifyPendingInstall_claimToken_key" ON "ShopifyPendingInstall"("claimToken");
