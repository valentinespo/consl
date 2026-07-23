-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Membership_clerkUserId_idx" ON "Membership"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_clerkUserId_orgId_key" ON "Membership"("clerkUserId", "orgId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
