-- The computed lifetime-value report per company (see lib/ltv-data.ts). Additive.
CREATE TABLE "LtvSnapshot" (
    "orgId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LtvSnapshot_pkey" PRIMARY KEY ("orgId")
);
