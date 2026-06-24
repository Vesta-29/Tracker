import TrackerApp from "@/components/tracker-app";
import { getSupabaseServer } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export default async function Home() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return <TrackerApp />;
  const supabase = await getSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (userId) {
    const { data: profile } = await supabase.from("profiles").select("active").eq("id", userId).maybeSingle();
    if (profile?.active) redirect("/dashboard");
  }
  return <TrackerApp />;
}
