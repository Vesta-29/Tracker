import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { generateTemporaryPassword } from "@/lib/temporary-password";

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
    const { email, fullName } = await request.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const name = String(fullName || "").trim();
    if (!normalizedEmail || !name) throw new Error("Enter a display name and email address.");
    if (name.length > 120) throw new Error("Use a display name with 120 characters or fewer.");
    const temporaryPassword = generateTemporaryPassword();
    const { data, error } = await supabase.auth.admin.createUser({ email: normalizedEmail, password: temporaryPassword, email_confirm: true, user_metadata: { full_name: name } });
    if (error) throw error;
    return NextResponse.json({ id: data.user.id, temporaryPassword });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create user." }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await requireAdmin(request);
    const { id, role, active } = await request.json();
    if (!["admin", "staff", "guest"].includes(role)) throw new Error("Choose a valid user role.");
    const { error } = await supabase.from("profiles").update({ role, active, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update user." }, { status: 400 }); }
}
