import { createClient } from "@supabase/supabase-js";

// Browser/anon client: read-only by design. RLS limits it to the signed-in user's workspace.
// Writes go through the Express API (apps/api), which holds the secret key.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
