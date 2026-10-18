import { createClient } from "@supabase/supabase-js";

// Browser/anon client: read-only by design. RLS limits it to the signed-in user's workspace.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
);
