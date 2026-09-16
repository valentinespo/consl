import { redirect } from "next/navigation";
import { requireView } from "@/lib/membership";

/** /settings has no content of its own — land on the first tab. */
export default async function SettingsIndexPage() {
  await requireView("settings");
  redirect("/settings/company");
}
