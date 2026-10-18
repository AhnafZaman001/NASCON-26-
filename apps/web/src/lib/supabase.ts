import { createClient } from "@supabase/supabase-js";

// Browser/anon client: read-only by design. RLS limits it to the signed-in user's workspace.
// Writes go through the Express API (apps/api), which holds the secret key.
// The session is kept in localStorage and refreshed automatically, so a page refresh stays signed in (F1.1).
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, storageKey: "nascon26.auth" } },
);
