import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const defaultTemporaryPassword = "Yeswecan123!";

async function requireAdmin(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new Error("Missing session.");
  const supabase = getSupabaseAdmin();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error("Invalid session.");
  const { data: profile } = await supabase.from("profiles").select("role,active").eq("id", user.id).single();
  if (!profile?.active || profile.role !== "admin") throw new Error("Administrator access required.");
  return { supabase, currentUserId: user.id };
}

export async function POST(request: Request) {
  try {
    const { supabase, currentUserId } = await requireAdmin(request);
    const { id } = await request.json();
    if (!id) throw new Error("Choose a user.");
    if (id === currentUserId) throw new Error("Use your account menu to change your own password.");
    const temporaryPassword = defaultTemporaryPassword;
    const { error } = await supabase.auth.admin.updateUserById(id, { password: temporaryPassword });
    if (error) throw error;
    return NextResponse.json({ temporaryPassword });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate a temporary password." }, { status: 400 });
  }
}
