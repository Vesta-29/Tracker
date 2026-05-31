import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function PATCH(request: Request) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!token) throw new Error("Missing session.");
    const { fullName } = await request.json();
    const name = String(fullName || "").trim();
    if (!name) throw new Error("Enter your name.");
    if (name.length > 120) throw new Error("Use a name with 120 characters or fewer.");

    const supabase = getSupabaseAdmin();
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error("Invalid session.");
    const { data: profile } = await supabase.from("profiles").select("active").eq("id", user.id).single();
    if (!profile?.active) throw new Error("Your FieldTrack account is inactive.");

    const { error } = await supabase.from("profiles").update({ full_name: name, updated_at: new Date().toISOString() }).eq("id", user.id);
    if (error) throw error;
    const { error: authError } = await supabase.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, full_name: name } });
    if (authError) throw authError;
    return NextResponse.json({ fullName: name });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update your name." }, { status: 400 });
  }
}
