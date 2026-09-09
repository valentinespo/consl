-- The onboarding wizard's background job record (catalogue pull / stock refresh).
ALTER TABLE "Settings" ADD COLUMN "onboardingJob" JSONB;
