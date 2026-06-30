-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LotLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
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
INSERT INTO "new_LotLine" ("cogPerUnit", "createdAt", "id", "lotId", "materialCostsJson", "otherCostPerUnit", "pouchCostPerUnit", "productId", "teaCostPerUnit", "teabagCostPerUnit", "units", "updatedAt") SELECT "cogPerUnit", "createdAt", "id", "lotId", "materialCostsJson", "otherCostPerUnit", "pouchCostPerUnit", "productId", "teaCostPerUnit", "teabagCostPerUnit", "units", "updatedAt" FROM "LotLine";
DROP TABLE "LotLine";
ALTER TABLE "new_LotLine" RENAME TO "LotLine";
CREATE TABLE "new_Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "Purchase_materialTypeId_fkey" FOREIGN KEY ("materialTypeId") REFERENCES "MaterialType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Purchase_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Purchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Purchase" ("createdAt", "date", "facilityId", "id", "isAdjustment", "materialTypeId", "notes", "productId", "quantity", "supplierId", "total", "unitCost", "updatedAt") SELECT "createdAt", "date", "facilityId", "id", "isAdjustment", "materialTypeId", "notes", "productId", "quantity", "supplierId", "total", "unitCost", "updatedAt" FROM "Purchase";
DROP TABLE "Purchase";
ALTER TABLE "new_Purchase" RENAME TO "Purchase";
CREATE INDEX "Purchase_materialTypeId_facilityId_productId_date_idx" ON "Purchase"("materialTypeId", "facilityId", "productId", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
