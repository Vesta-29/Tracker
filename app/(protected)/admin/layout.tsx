import { requireProfile } from "@/lib/route-auth";
import TrackerApp from "@/components/tracker-app";

export default async function AdminLayout() {
  await requireProfile(["admin"]);
  return <TrackerApp />;
}
