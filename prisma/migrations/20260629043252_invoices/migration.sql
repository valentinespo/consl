-- CreateTable
CREATE TABLE "PurchaseInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT,
    "materialTypeId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "invoiceTotal" REAL NOT NULL DEFAULT 0,
    "isAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "documentUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PurchaseInvoice_materialTypeId_fkey" FOREIGN KEY ("materialTypeId") REFERENCES "MaterialType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransactionInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT,
    "date" DATETIME,
    "invoiceTotal" REAL NOT NULL DEFAULT 0,
    "documentUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransactionInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT,
    "materialTypeId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "supplierId" TEXT,
    "facilityId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" REAL NOT NULL,
    "unitCost" REAL NOT NULL,
    "total" REAL NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "isAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Purchase_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PurchaseInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Purchase_materialTypeId_fkey" FOREIGN KEY ("materialTypeId") REFERENCES "MaterialType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Purchase_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Purchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Purchase" ("createdAt", "date", "facilityId", "id", "isAdjustment", "materialTypeId", "notes", "productId", "quantity", "seq", "supplierId", "total", "unitCost", "updatedAt") SELECT "createdAt", "date", "facilityId", "id", "isAdjustment", "materialTypeId", "notes", "productId", "quantity", "seq", "supplierId", "total", "unitCost", "updatedAt" FROM "Purchase";
DROP TABLE "Purchase";
ALTER TABLE "new_Purchase" RENAME TO "Purchase";
CREATE INDEX "Purchase_materialTypeId_facilityId_productId_date_idx" ON "Purchase"("materialTypeId", "facilityId", "productId", "date");
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT,
    "lotId" TEXT,
    "date" DATETIME,
    "supplierId" TEXT,
    "invoiceAmount" REAL,
    "applicableAmount" REAL NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT 'TEA',
    "appliesToCog" BOOLEAN NOT NULL DEFAULT true,
    "skus" TEXT,
    "concept" TEXT,
    "invoiceFileUrl" TEXT,
    "notApplicableAmount" REAL,
    "notApplicableConcept" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "TransactionInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("applicableAmount", "appliesToCog", "category", "concept", "createdAt", "date", "id", "invoiceAmount", "invoiceFileUrl", "lotId", "notApplicableAmount", "notApplicableConcept", "skus", "supplierId", "updatedAt") SELECT "applicableAmount", "appliesToCog", "category", "concept", "createdAt", "date", "id", "invoiceAmount", "invoiceFileUrl", "lotId", "notApplicableAmount", "notApplicableConcept", "skus", "supplierId", "updatedAt" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_lotId_idx" ON "Transaction"("lotId");
CREATE INDEX "Transaction_invoiceId_idx" ON "Transaction"("invoiceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
