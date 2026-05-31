import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

async function requireAdmin(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new Error("Missing session.");
  const supabase = getSupabaseAdmin();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error("Invalid session.");
  const { data: profile } = await supabase.from("profiles").select("role,active").eq("id", user.id).single();
  if (!profile?.active || profile.role !== "admin") throw new Error("Administrator access required.");
  return supabase;
}

export async function GET(request: Request) {
  try {
    const supabase = await requireAdmin(request);
    const { data, error } = await supabase.from("profiles").select("id,full_name,email,role,active").order("full_name");
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load users." }, { status: 403 }); }
}

export async function POST(request: Request) {
  try {
    const supabase = await requireAdmin(request);
    const { email, redirectTo } = await request.json();
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error) throw error;
    return NextResponse.json({ id: data.user.id });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to invite user." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await requireAdmin(request);
    const { id, role, active } = await request.json();
    const { error } = await supabase.from("profiles").update({ role, active, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update user." }, { status: 400 }); }
}
