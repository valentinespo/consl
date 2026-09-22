import { getMyAccess } from "@/lib/membership";
import { getLtvContext } from "@/lib/ltv-context";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const access = await getMyAccess();
  if (!access) return Response.json({ error: "Not signed in." }, { status: 401, headers });
  if (!access.can("dashboard", "view")) return Response.json({ error: "Not authorized." }, { status: 403, headers });
  const { revision } = await getLtvContext();
  // No orders, customer identifiers or company settings leave this endpoint.
  return Response.json({ revision }, { headers });
}
