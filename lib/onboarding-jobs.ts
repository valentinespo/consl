import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId, runWithOrg } from "@/lib/tenant";

/**
 * Background work for the onboarding wizard. Continue must answer at once, so anything that
 * talks to a sales platform (pulling a catalogue, reading stock) runs detached from the request
 * and reports its progress into Settings.onboardingJob. The wizard polls that record: steps that
 * don't need the result carry on; a step that does shows a progress dialog until it lands.
 *
 * Detached means a fresh macrotask (setImmediate), NOT Next's `after()`: on this server `after`
 * held the action's response open until the callback finished — the very wait this exists to
 * remove. The job runs on the same long-lived Node process the scheduler does.
 */

export type OnboardingJobKind = "pull" | "stock";

export type OnboardingJob = {
  kind: OnboardingJobKind;
  startedAt: string;
  finishedAt: string | null;
  /** What the job is doing right now, in the user's words ("Reading your Amazon listings…"). */
  phase: string;
  /** Set when the job finished with something it couldn't do; null on a clean finish. */
  error: string | null;
  /** Typical duration, for the dialog's time estimate. */
  expectedSeconds: number;
};

/** A job that never reported back (the server restarted mid-way) is not "running" forever. */
export function jobRunning(job: OnboardingJob | null | undefined): boolean {
  if (!job || job.finishedAt) return false;
  return Date.now() - new Date(job.startedAt).getTime() < Math.max(90_000, job.expectedSeconds * 6_000);
}

export async function readOnboardingJob(): Promise<OnboardingJob | null> {
  const s = await prisma.settings.findFirst({ select: { onboardingJob: true } });
  return (s?.onboardingJob as OnboardingJob | null) ?? null;
}

async function writeJob(job: OnboardingJob): Promise<void> {
  const s = await prisma.settings.findFirst({ select: { id: true } });
  if (s) await prisma.settings.update({ where: { id: s.id }, data: { onboardingJob: job } });
}

/**
 * Start a job for the current company. The record is written before the response returns (so
 * the wizard can show it immediately); `work` runs once the response is out, inside the same
 * company context, reporting phases as it goes and returning a problem message or null.
 */
export async function startOnboardingJob(
  kind: OnboardingJobKind,
  expectedSeconds: number,
  work: (report: (phase: string) => Promise<void>) => Promise<string | null>,
): Promise<void> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return;
  const job: OnboardingJob = { kind, startedAt: new Date().toISOString(), finishedAt: null, phase: "", error: null, expectedSeconds };
  await writeJob(job);
  setImmediate(() => {
    void runWithOrg(orgId, async () => {
      const report = async (phase: string) => {
        job.phase = phase;
        await writeJob({ ...job });
      };
      let error: string | null = null;
      try {
        error = await work(report);
      } catch (e) {
        error = e instanceof Error ? e.message : "Something went wrong.";
      }
      job.finishedAt = new Date().toISOString();
      job.error = error;
      job.phase = "";
      await writeJob({ ...job }).catch((e) => console.error("[onboarding-job] could not record finish:", (e as Error).message));
    });
  });
}
