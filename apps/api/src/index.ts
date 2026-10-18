// Local / long-running server: the app plus background jobs that a serverless host can't run.
import app from "./app.ts";
import { supabaseAdmin } from "./lib/supabase.ts";
import { startTwilioPoller } from "./routes/messaging.ts";

// Lead escalation sweep (F3.5). pg_cron runs the same function, but its timing on Supabase is not
// guaranteed; running it here too is safe because escalate_expired_leads() locks rows (SKIP LOCKED),
// so a lead can never escalate twice (F3.8). Disable with ESCALATION_SWEEP=off.
if (process.env.ESCALATION_SWEEP !== "off" && process.env.SUPABASE_SECRET_KEY) {
  setInterval(async () => {
    const { error } = await supabaseAdmin().rpc("escalate_expired_leads");
    if (error) console.error("[api] escalation sweep:", error.message);
  }, 5_000);
}

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`[api] listening on http://localhost:${port}`));
startTwilioPoller();
