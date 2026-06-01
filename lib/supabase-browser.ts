import { createBrowserClient } from "@supabase/ssr";

export const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
function createSupabaseBrowser() { return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!); }
let browserClient: ReturnType<typeof createSupabaseBrowser> | undefined;

export function getSupabaseBrowser() {
  if (!supabaseConfigured) throw new Error("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.");
  browserClient ??= createSupabaseBrowser();
  return browserClient;
}
