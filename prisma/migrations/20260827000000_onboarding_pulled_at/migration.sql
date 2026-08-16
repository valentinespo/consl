-- Stamp of the wizard's last channel-data pull, so returning to step 1 with nothing newly
-- connected offers a plain Continue instead of re-running the pull.
ALTER TABLE "Settings" ADD COLUMN "onboardingPulledAt" TIMESTAMP(3);
