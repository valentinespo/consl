import { NextResponse } from "next/server";
import { getMyAccess } from "@/lib/membership";
import { listUsableXeroAccounts } from "@/lib/xero-setup";

export const dynamic = "force-dynamic";

/**
 * The company's Xero chart of accounts, read live — the setup screen asks for it again when you
 * come back to the tab or press Refresh, so an account just created in Xero shows up at once
 * (Xero sends no webhooks for accounts).
 */
export async function GET() {
  const access = await getMyAccess();
  if (!access?.can("settings", "view")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  try {
    return NextResponse.json(await listUsableXeroAccounts(access.orgId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't read Xero." }, { status: 502 });
  }
}
