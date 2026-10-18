import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";

// Service-role client. Bypasses RLS, so every caller MUST check the user's workspace
// and permission first. Created lazily so the server boots (and /api/health works) without keys.
let client: SupabaseClient | undefined;
export function supabaseAdmin() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
      console.error("[api] SUPABASE_URL / SUPABASE_SECRET_KEY not set (see apps/api/.env.example)");
      throw new HttpError(503, "The server isn't configured yet (Supabase secret key missing). Ask the team to set it up.");
    }
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}
