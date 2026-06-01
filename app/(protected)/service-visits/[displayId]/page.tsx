import TrackerApp from "@/components/tracker-app";
import { requireDisplayId } from "@/lib/route-auth";

export default async function ServiceVisitDetailPage({ params }: { params: Promise<{ displayId: string }> }) {
  const { displayId } = await params;
  await requireDisplayId("service_visits", displayId);
  return <TrackerApp />;
}
