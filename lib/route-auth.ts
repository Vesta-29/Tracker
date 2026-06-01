import { notFound, redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase-server";
import type { Profile } from "@/lib/types";

export async function requireProfile(roles?: Profile["role"][]) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const { data } = await supabase.from("profiles").select("id,full_name,email,role,active").eq("id", user.id).maybeSingle();
  if (!data?.active) redirect("/");
  const profile: Profile = { id: data.id, fullName: data.full_name, email: data.email, role: data.role, active: data.active };
  if (roles && !roles.includes(profile.role)) redirect("/dashboard");
  return profile;
}

export async function requireDisplayId(table: "installations" | "service_visits", displayId: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.from(table).select("display_id").eq("display_id", displayId).maybeSingle();
  if (!data) notFound();
}
