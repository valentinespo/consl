import { notFound } from "next/navigation";
import { isSuperuser } from "@/lib/superuser";

export const dynamic = "force-dynamic";

/** The internal area: the admin account only. The middleware already turns everyone else away;
 *  this is the backstop, failing closed to a 404 so the area's existence isn't advertised. */
export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSuperuser())) notFound();
  return <>{children}</>;
}
