-- Early access: the public application questionnaire and the company-level billing gate.
--
-- Every company that exists when this runs is marked billing-exempt: the paywall (and the
-- pre-onboarding waiting screen) only ever applies to companies created through the application
-- flow from here on. New rows default to NOT exempt.
ALTER TABLE "Organization" ADD COLUMN "billingExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "trialUnlockedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "subscriptionStatus" TEXT;
UPDATE "Organization" SET "billingExempt" = true;

CREATE TABLE "AccessApplication" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'started',
    "completedAt" TIMESTAMP(3),
    "fullName" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "channels" JSONB,
    "mainChannel" TEXT,
    "fulfillment" JSONB,
    "longTermStock" JSONB,
    "lotTracking" TEXT,
    "lotTrackingTool" TEXT,
    "lotTrackingHow" TEXT,
    "adsChannels" JSONB,
    "bookkeepingTool" TEXT,
    "bookkeeping" TEXT,
    "challenge" TEXT,
    "source" TEXT,
    "clerkUserId" TEXT,
    "orgId" TEXT,
    "accountCreatedAt" TIMESTAMP(3),
    "callBookedAt" TIMESTAMP(3),
    "calendlyEventUri" TEXT,
    "calendlyInviteeUri" TEXT,

    CONSTRAINT "AccessApplication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccessApplication_email_idx" ON "AccessApplication"("email");
CREATE INDEX "AccessApplication_orgId_idx" ON "AccessApplication"("orgId");
CREATE INDEX "AccessApplication_createdAt_idx" ON "AccessApplication"("createdAt");

ALTER TABLE "AccessApplication" ADD CONSTRAINT "AccessApplication_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
