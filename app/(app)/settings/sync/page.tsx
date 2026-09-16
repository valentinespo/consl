import { redirect } from "next/navigation";

/** The old combined "Sync & restock" tab split into "Time zone" and "Restock defaults". Keep this
 *  path alive so any bookmark lands somewhere sensible. */
export default function SyncSettingsRedirect() {
  redirect("/settings/timezone");
}
