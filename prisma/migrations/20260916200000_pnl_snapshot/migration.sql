-- The precomputed P&L history per company (see lib/pnl-cache.ts). Additive.
CREATE TABLE "PnlSnapshot" (
    "orgId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PnlSnapshot_pkey" PRIMARY KEY ("orgId")
);
