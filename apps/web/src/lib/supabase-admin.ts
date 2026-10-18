import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client. Bypasses RLS, so every caller MUST check the user's workspace
// and permission first (see src/server/authz.ts). Never import this into client code.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
