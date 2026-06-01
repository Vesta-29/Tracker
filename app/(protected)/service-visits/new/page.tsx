import TrackerApp from "@/components/tracker-app";
import { requireProfile } from "@/lib/route-auth";

export default async function NewServiceVisitPage() {
  await requireProfile(["admin", "staff"]);
  return <TrackerApp />;
}
