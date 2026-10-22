import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase.ts";
import { must } from "../lib/http.ts";
import { drainEmails } from "../lib/mailer.ts";
import { can, ctxOf, requireMember, requirePerm } from "../middleware/auth.ts";

// I4: alert emails are queued by the database (migration 0020) and sent by lib/mailer.ts.
export const emails = Router();

// GET /api/emails - recent alerts. Admins (integrations.manage) see the whole workspace incl. failures; others only their own.
emails.get("/", requireMember, async (req, res) => {
  const ctx = ctxOf(req);
  let q = supabaseAdmin()
    .from("emails")
    .select("id, to_email, subject, status, attempts, max_attempts, last_error, created_at, sent_at")
    .eq("workspace_id", ctx.member.workspaceId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (!can(ctx, "integrations.manage")) q = q.eq("user_id", ctx.user.id);
  res.json({ emails: must(await q) });
});

// POST /api/emails/send - send whatever is due right now ("Send now" button, also handy for testing).
emails.post("/send", requireMember, requirePerm("integrations.manage"), async (_req, res) => {
  res.json(await drainEmails(50));
});
