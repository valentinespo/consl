import { redirect } from "next/navigation";

// The In-production tab was merged into the single Inventory page.
export default function ProductionRedirect() {
  redirect("/inventory");
}
