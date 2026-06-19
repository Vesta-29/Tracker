import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getSupabaseServer } from "@/lib/supabase-server";
import type { Profile } from "@/lib/types";

const loadProfile = cache(async () => {
  const supabase = await getSupabaseServer();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/");
  const { data } = await supabase.from("profiles").select("id,full_name,email,role,active").eq("id", userId).maybeSingle();
  if (!data?.active) redirect("/");
  return { id: data.id, fullName: data.full_name, email: data.email, role: data.role, active: data.active } as Profile;
});

export async function requireProfile(roles?: Profile["role"][]) {
  const profile = await loadProfile();
  if (roles && !roles.includes(profile.role)) redirect("/dashboard");
  return profile;
}

export async function requireDisplayId(table: "installations" | "service_visits", displayId: string) {
  const supabase = await getSupabaseServer();
  const column = table === "installations" ? "school_id" : "display_id";
  const { data } = await supabase.from(table).select(column).eq(column, displayId).maybeSingle();
  if (!data) notFound();
}
