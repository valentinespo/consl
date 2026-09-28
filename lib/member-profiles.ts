import "server-only";
import { clerkClient } from "@clerk/nextjs/server";

export type MemberProfile = { name: string | null; email: string | null };

const LOOKUP_MS = 5_000;

/**
 * Names and emails for sign-in accounts, read from Clerk (consl stores only the account id).
 * Best effort: an account Clerk doesn't return, or a slow or failed lookup, is simply missing from
 * the map, and the caller shows what it has.
 */
export async function memberProfiles(clerkUserIds: string[]): Promise<Map<string, MemberProfile>> {
  const out = new Map<string, MemberProfile>();
  const ids = [...new Set(clerkUserIds)].filter((id) => id.startsWith("user_"));
  if (!ids.length) return out;
  try {
    const client = await clerkClient();
    const lookup = async () => {
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await client.users.getUserList({ userId: ids.slice(i, i + 100), limit: 100 });
        for (const u of data) {
          out.set(u.id, {
            name: u.fullName?.trim() || u.username || null,
            email: u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null,
          });
        }
      }
    };
    await Promise.race([lookup(), new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), LOOKUP_MS))]);
  } catch (e) {
    console.error("[team] member lookup failed:", (e as Error).message);
  }
  return out;
}
