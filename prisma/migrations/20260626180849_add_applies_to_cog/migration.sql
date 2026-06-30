-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotId" TEXT NOT NULL,
    "date" DATETIME,
    "supplierId" TEXT,
    "invoiceAmount" REAL,
    "applicableAmount" REAL NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT 'TEA',
    "appliesToCog" BOOLEAN NOT NULL DEFAULT true,
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
INSERT INTO "new_Transaction" ("applicableAmount", "category", "concept", "createdAt", "date", "id", "invoiceAmount", "invoiceFileUrl", "lotId", "notApplicableAmount", "notApplicableConcept", "skus", "supplierId", "updatedAt") SELECT "applicableAmount", "category", "concept", "createdAt", "date", "id", "invoiceAmount", "invoiceFileUrl", "lotId", "notApplicableAmount", "notApplicableConcept", "skus", "supplierId", "updatedAt" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_lotId_idx" ON "Transaction"("lotId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
