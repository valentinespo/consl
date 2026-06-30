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
    "shortfallsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LotLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LotLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_LotLine" ("cogPerUnit", "createdAt", "id", "lotId", "materialCostsJson", "otherCostPerUnit", "pouchCostPerUnit", "productId", "seq", "teaCostPerUnit", "teabagCostPerUnit", "units", "updatedAt") SELECT "cogPerUnit", "createdAt", "id", "lotId", "materialCostsJson", "otherCostPerUnit", "pouchCostPerUnit", "productId", "seq", "teaCostPerUnit", "teabagCostPerUnit", "units", "updatedAt" FROM "LotLine";
DROP TABLE "LotLine";
ALTER TABLE "new_LotLine" RENAME TO "LotLine";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
