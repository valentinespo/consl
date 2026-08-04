import { requireView } from "@/lib/membership";
import { getKeyDocuments } from "@/app/settings/actions";
import { KeyDocumentsEditor } from "@/components/KeyDocumentsEditor";

export const dynamic = "force-dynamic";

export default async function DocumentsSettingsPage() {
  await requireView("settings");
  const keyDocuments = await getKeyDocuments();
  return <KeyDocumentsEditor initial={keyDocuments} />;
}
