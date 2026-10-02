import { NextResponse, type NextRequest } from "next/server";
import { getMyAccess } from "@/lib/membership";
import { startingInventory } from "@/lib/xero-setup";
import { isIsoDay } from "@/lib/xero-setup-shared";

export const dynamic = "force-dynamic";

/**
 * The setup screen's starting-inventory comparison for a start date: consl's stock value and
 * Xero's balance in the inventory account (`account`, an AccountID; none for a new account), both
 * at the end of the day before. Read-only.
 */
export async function GET(req: NextRequest) {
  const access = await getMyAccess();
  if (!access?.can("settings", "view")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const start = req.nextUrl.searchParams.get("start") ?? "";
  const account = req.nextUrl.searchParams.get("account") || null;
  if (!isIsoDay(start)) return NextResponse.json({ error: "Pick a start date." }, { status: 400 });
  try {
    return NextResponse.json(await startingInventory(access.orgId, start, account));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't read Xero." }, { status: 502 });
  }
}
