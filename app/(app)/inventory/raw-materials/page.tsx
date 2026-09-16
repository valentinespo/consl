import { redirect } from "next/navigation";

// The Raw-materials tab was merged into the single Inventory page.
export default function RawMaterialsRedirect() {
  redirect("/inventory");
}
