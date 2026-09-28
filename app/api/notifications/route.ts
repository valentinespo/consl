import { getMyAccess } from "@/lib/membership";
import { getRestock } from "@/lib/restock";
import { getAlerts } from "@/lib/alerts";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * The header bell's alerts, for the company in context. A plain GET on purpose, not a Server
 * Action: Next runs a page's Server Actions one at a time, so a bell that loaded through one made
 * every save on a freshly opened page wait until the alerts were computed.
 */
export async function GET() {
  const access = await getMyAccess();
  if (!access) return Response.json({ alerts: [] }, { status: 401, headers });
  if (!access.can("dashboard", "view")) return Response.json({ alerts: [] }, { headers });
  try {
    const restock = await getRestock();
    return Response.json({ alerts: await getAlerts(restock.rows) }, { headers });
  } catch {
    // A transient read failure is an empty bell, never an error on the page.
    return Response.json({ alerts: [] }, { headers });
  }
}
