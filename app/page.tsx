import TrackerApp from "@/components/tracker-app";
import { getSupabaseServer } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export default async function Home() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return <TrackerApp />;
  const supabase = await getSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) redirect("/dashboard");
  return <TrackerApp />;
}
