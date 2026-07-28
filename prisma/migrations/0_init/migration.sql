-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('IN_PRODUCTION', 'FINISHED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legalName" TEXT,
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "logoUrl" TEXT,
    "iconUrl" TEXT,
    "brandInk" TEXT NOT NULL DEFAULT '#1f2937',
    "brandBand" TEXT NOT NULL DEFAULT '#eef2f7',
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "currencySymbol" TEXT NOT NULL DEFAULT '$',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "permissions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "invitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'co-packer',
    "legalName" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "itemType" TEXT NOT NULL DEFAULT 'FINISHED',
    "productId" TEXT,
    "materialTypeId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "fromFacilityId" TEXT NOT NULL,
    "toFacilityId" TEXT,
    "toDestination" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "photoUrl" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "facilityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "notes" TEXT,
    "barcode" TEXT,
    "asin" TEXT,
    "sellerSku" TEXT,
    "fnsku" TEXT,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "shopifySku" TEXT,
    "tiktokProductId" TEXT,
    "tiktokSku" TEXT,
    "minMonths" DOUBLE PRECISION,
    "leadMonths" DOUBLE PRECISION,
    "shipDays" INTEGER,
    "reorderToMonths" DOUBLE PRECISION,
    "batchSize" INTEGER,
    "sortIndex" INTEGER,
    "windowDays" INTEGER,
    "excludeDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "productId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fbaAvailable" INTEGER NOT NULL DEFAULT 0,
    "fbaInbound" INTEGER NOT NULL DEFAULT 0,
    "fbaReserved" INTEGER NOT NULL DEFAULT 0,
    "fbaUnfulfillable" INTEGER NOT NULL DEFAULT 0,
    "fbaTotal" INTEGER NOT NULL DEFAULT 0,
    "awdOnhand" INTEGER NOT NULL DEFAULT 0,
    "awdInbound" INTEGER NOT NULL DEFAULT 0,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "dailySales" JSONB,
    "salesEnd" TIMESTAMP(3),
    "units10d" INTEGER NOT NULL DEFAULT 0,
    "units30d" INTEGER NOT NULL DEFAULT 0,
    "units90d" INTEGER NOT NULL DEFAULT 0,
    "salesDays10" INTEGER NOT NULL DEFAULT 0,
    "salesDays30" INTEGER NOT NULL DEFAULT 0,
    "salesDays90" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SkuSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DismissedNotification" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "orgId" TEXT,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DismissedNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryValueSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "day" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" DOUBLE PRECISION NOT NULL,
    "inProduction" DOUBLE PRECISION NOT NULL,
    "fba" DOUBLE PRECISION NOT NULL,
    "awd" DOUBLE PRECISION NOT NULL,
    "atLocations" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "InventoryValueSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "defaultMinMonths" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "defaultLeadMonths" DOUBLE PRECISION NOT NULL DEFAULT 4.5,
    "shipMonths" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "shipDays" INTEGER NOT NULL DEFAULT 30,
    "shipBufferX" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "defaultReorderTo" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "defaultBatchSize" INTEGER NOT NULL DEFAULT 0,
    "sortMode" TEXT NOT NULL DEFAULT 'sales',
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "syncHour" INTEGER NOT NULL DEFAULT 5,
    "syncMinute" INTEGER NOT NULL DEFAULT 0,
    "syncTz" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "lastSyncRun" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "dashboardLayout" JSONB,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialType" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitLabel" TEXT NOT NULL DEFAULT 'unit',
    "defaultPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "poolKey" TEXT NOT NULL DEFAULT 'FACILITY',
    "skuSpecific" BOOLEAN NOT NULL DEFAULT false,
    "lowStockThreshold" DOUBLE PRECISION,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "supplierId" TEXT,
    "materialTypeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "invoiceTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "documentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "invoiceId" TEXT,
    "materialTypeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "supplierId" TEXT,
    "facilityId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "isAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "poNumber" TEXT,
    "lotNr" INTEGER NOT NULL,
    "poDate" TIMESTAMP(3),
    "facilityId" TEXT NOT NULL,
    "status" "LotStatus" NOT NULL DEFAULT 'IN_PRODUCTION',
    "finishedAt" TIMESTAMP(3),
    "notes" TEXT,
    "inboundPaidTotal" DOUBLE PRECISION,
    "inboundPaidPerUnit" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "label" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "lotId" TEXT,
    "transactionInvoiceId" TEXT,
    "purchaseInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "facilityId" TEXT NOT NULL,
    "lotId" TEXT,
    "pdfUrl" TEXT,
    "total" DOUBLE PRECISION,
    "notes" TEXT,
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "poId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'SKU',
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "unitCost" DOUBLE PRECISION,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lotUnits" DOUBLE PRECISION,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "lotId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "teaCostPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherCostPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "teabagCostPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pouchCostPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cogPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "materialCostsJson" TEXT NOT NULL DEFAULT '{}',
    "transactionCostsJson" TEXT NOT NULL DEFAULT '{}',
    "shortfallsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LotLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotMaterial" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "lotLineId" TEXT NOT NULL,
    "materialTypeId" TEXT NOT NULL,
    "perUnit" DOUBLE PRECISION NOT NULL,
    "productId" TEXT,

    CONSTRAINT "LotMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionInvoice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "supplierId" TEXT,
    "date" TIMESTAMP(3),
    "invoiceTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "documentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "invoiceId" TEXT,
    "lotId" TEXT,
    "date" TIMESTAMP(3),
    "supplierId" TEXT,
    "invoiceAmount" DOUBLE PRECISION,
    "applicableAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT 'Ingredients',
    "appliesToCog" BOOLEAN NOT NULL DEFAULT true,
    "skus" TEXT,
    "concept" TEXT,
    "invoiceFileUrl" TEXT,
    "notApplicableAmount" DOUBLE PRECISION,
    "notApplicableConcept" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Membership_clerkUserId_idx" ON "Membership"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_clerkUserId_orgId_key" ON "Membership"("clerkUserId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");

-- CreateIndex
CREATE INDEX "Invite_orgId_idx" ON "Invite"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Facility_orgId_code_key" ON "Facility"("orgId", "code");

-- CreateIndex
CREATE INDEX "StockMovement_productId_date_idx" ON "StockMovement"("productId", "date");

-- CreateIndex
CREATE INDEX "StockMovement_materialTypeId_date_idx" ON "StockMovement"("materialTypeId", "date");

-- CreateIndex
CREATE INDEX "StockMovement_fromFacilityId_idx" ON "StockMovement"("fromFacilityId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_facilityId_key" ON "Supplier"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_orgId_name_key" ON "Supplier"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_orgId_code_key" ON "Product"("orgId", "code");

-- CreateIndex
CREATE INDEX "SkuSnapshot_productId_capturedAt_idx" ON "SkuSnapshot"("productId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DismissedNotification_orgId_key_key" ON "DismissedNotification"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryValueSnapshot_orgId_day_key" ON "InventoryValueSnapshot"("orgId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_orgId_key" ON "Settings"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialType_orgId_code_key" ON "MaterialType"("orgId", "code");

-- CreateIndex
CREATE INDEX "Purchase_materialTypeId_facilityId_productId_date_idx" ON "Purchase"("materialTypeId", "facilityId", "productId", "date");

-- CreateIndex
CREATE INDEX "Lot_lotNr_idx" ON "Lot"("lotNr");

-- CreateIndex
CREATE INDEX "LotDocument_lotId_idx" ON "LotDocument"("lotId");

-- CreateIndex
CREATE INDEX "LotDocument_transactionInvoiceId_idx" ON "LotDocument"("transactionInvoiceId");

-- CreateIndex
CREATE INDEX "LotDocument_purchaseInvoiceId_idx" ON "LotDocument"("purchaseInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_lotId_key" ON "PurchaseOrder"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_orgId_number_key" ON "PurchaseOrder"("orgId", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_poId_idx" ON "PurchaseOrderLine"("poId");

-- CreateIndex
CREATE UNIQUE INDEX "LotMaterial_lotLineId_materialTypeId_key" ON "LotMaterial"("lotLineId", "materialTypeId");

-- CreateIndex
CREATE INDEX "Transaction_lotId_idx" ON "Transaction"("lotId");

-- CreateIndex
CREATE INDEX "Transaction_invoiceId_idx" ON "Transaction"("invoiceId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_materialTypeId_fkey" FOREIGN KEY ("materialTypeId") REFERENCES "MaterialType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_fromFacilityId_fkey" FOREIGN KEY ("fromFacilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_toFacilityId_fkey" FOREIGN KEY ("toFacilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuSnapshot" ADD CONSTRAINT "SkuSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuSnapshot" ADD CONSTRAINT "SkuSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DismissedNotification" ADD CONSTRAINT "DismissedNotification_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryValueSnapshot" ADD CONSTRAINT "InventoryValueSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialType" ADD CONSTRAINT "MaterialType_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_materialTypeId_fkey" FOREIGN KEY ("materialTypeId") REFERENCES "MaterialType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_materialTypeId_fkey" FOREIGN KEY ("materialTypeId") REFERENCES "MaterialType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotDocument" ADD CONSTRAINT "LotDocument_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotDocument" ADD CONSTRAINT "LotDocument_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotDocument" ADD CONSTRAINT "LotDocument_transactionInvoiceId_fkey" FOREIGN KEY ("transactionInvoiceId") REFERENCES "TransactionInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotDocument" ADD CONSTRAINT "LotDocument_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotLine" ADD CONSTRAINT "LotLine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotLine" ADD CONSTRAINT "LotLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotLine" ADD CONSTRAINT "LotLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotMaterial" ADD CONSTRAINT "LotMaterial_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotMaterial" ADD CONSTRAINT "LotMaterial_lotLineId_fkey" FOREIGN KEY ("lotLineId") REFERENCES "LotLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotMaterial" ADD CONSTRAINT "LotMaterial_materialTypeId_fkey" FOREIGN KEY ("materialTypeId") REFERENCES "MaterialType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotMaterial" ADD CONSTRAINT "LotMaterial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionInvoice" ADD CONSTRAINT "TransactionInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionInvoice" ADD CONSTRAINT "TransactionInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "TransactionInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

