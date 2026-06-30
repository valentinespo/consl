-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'co-packer',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "photoUrl" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MaterialType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitLabel" TEXT NOT NULL DEFAULT 'unit',
    "defaultPerUnit" REAL NOT NULL DEFAULT 1,
    "poolKey" TEXT NOT NULL DEFAULT 'FACILITY',
    "skuSpecific" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialTypeId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "supplierId" TEXT,
    "facilityId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" REAL NOT NULL,
    "unitCost" REAL NOT NULL,
    "total" REAL NOT NULL,
    "isAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Purchase_materialTypeId_fkey" FOREIGN KEY ("materialTypeId") REFERENCES "MaterialType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Purchase_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Purchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poNumber" TEXT,
    "lotNr" INTEGER NOT NULL,
    "poDate" DATETIME,
    "facilityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PRODUCTION',
    "notes" TEXT,
    "inboundPaidTotal" REAL,
    "inboundPaidPerUnit" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lot_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LotLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "teaCostPerUnit" REAL NOT NULL DEFAULT 0,
    "otherCostPerUnit" REAL NOT NULL DEFAULT 0,
    "teabagCostPerUnit" REAL NOT NULL DEFAULT 0,
    "pouchCostPerUnit" REAL NOT NULL DEFAULT 0,
    "cogPerUnit" REAL NOT NULL DEFAULT 0,
    "materialCostsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LotLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LotLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LotMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotLineId" TEXT NOT NULL,
    "materialTypeId" TEXT NOT NULL,
    "perUnit" REAL NOT NULL,
    "productId" TEXT,
    CONSTRAINT "LotMaterial_lotLineId_fkey" FOREIGN KEY ("lotLineId") REFERENCES "LotLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LotMaterial_materialTypeId_fkey" FOREIGN KEY ("materialTypeId") REFERENCES "MaterialType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LotMaterial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotId" TEXT NOT NULL,
    "date" DATETIME,
    "supplierId" TEXT,
    "invoiceAmount" REAL,
    "applicableAmount" REAL NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT 'TEA',
    "skus" TEXT,
    "concept" TEXT,
    "notApplicableAmount" REAL,
    "notApplicableConcept" TEXT,
    "invoiceFileUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Facility_code_key" ON "Facility"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialType_code_key" ON "MaterialType"("code");

-- CreateIndex
CREATE INDEX "Purchase_materialTypeId_facilityId_productId_date_idx" ON "Purchase"("materialTypeId", "facilityId", "productId", "date");

-- CreateIndex
CREATE INDEX "Lot_lotNr_idx" ON "Lot"("lotNr");

-- CreateIndex
CREATE UNIQUE INDEX "LotMaterial_lotLineId_materialTypeId_key" ON "LotMaterial"("lotLineId", "materialTypeId");

-- CreateIndex
CREATE INDEX "Transaction_lotId_idx" ON "Transaction"("lotId");
