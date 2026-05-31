import { getSupabase } from "./supabase-admin.mjs";

const email = process.env.INITIAL_ADMIN_EMAIL;
const redirectTo = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
if (!email) throw new Error("Set INITIAL_ADMIN_EMAIL in .env.local.");
const supabase = getSupabase();

const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: email.split("@")[0] } });
if (inviteError && !inviteError.message.toLowerCase().includes("already")) throw inviteError;
let userId = invited?.user?.id;
if (!userId) {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;
  userId = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase())?.id;
}
if (!userId) throw new Error(`Could not locate invited user ${email}.`);
const { error } = await supabase.from("profiles").upsert({ id: userId, email, full_name: email.split("@")[0], role: "admin", active: true });
if (error) throw error;
console.log(`Invited and promoted ${email} to admin.`);
