-- TikTok Shop issues a short-lived access token alongside its rotating refresh token; cache the
-- current access token (encrypted, lib/secret-box.ts) and its expiry on the connection so API
-- calls reuse it until a refresh is actually due. Additive only — existing providers stay null.

ALTER TABLE "Integration" ADD COLUMN "accessTokenEnc" TEXT;
ALTER TABLE "Integration" ADD COLUMN "accessTokenExpiresAt" TIMESTAMP(3);
