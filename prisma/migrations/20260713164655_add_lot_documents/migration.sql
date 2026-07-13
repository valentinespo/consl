-- CreateTable
CREATE TABLE "LotDocument" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LotDocument_lotId_idx" ON "LotDocument"("lotId");

-- AddForeignKey
ALTER TABLE "LotDocument" ADD CONSTRAINT "LotDocument_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
