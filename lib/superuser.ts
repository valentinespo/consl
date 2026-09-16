import "server-only";
import { currentUserId, devAuthBypass } from "@/lib/current-user";
import { isSuperuserId } from "@/lib/superuser-ids";

/** True for the admin account — and in local dev, which has no session to check. */
export async function isSuperuser(): Promise<boolean> {
  if (devAuthBypass) return true;
  return isSuperuserId(await currentUserId());
}

/** Guard for the internal area's server actions. */
export async function requireSuperuser(): Promise<{ ok: true } | { ok: false; error: string }> {
  return (await isSuperuser()) ? { ok: true } : { ok: false, error: "Not allowed." };
}
