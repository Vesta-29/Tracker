import TrackerApp from "@/components/tracker-app";
import { requireDisplayId } from "@/lib/route-auth";

export default async function SiteDetailPage({ params }: { params: Promise<{ displayId: string }> }) {
  const { displayId } = await params;
  await requireDisplayId("installations", displayId);
  return <TrackerApp />;
}
