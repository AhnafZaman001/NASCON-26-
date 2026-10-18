import { Router } from "express";
import { enqueueUserEmails } from "@nascon/queue";
import { supabaseAdmin } from "../lib/supabase.ts";
import { requireUser, type AuthedRequest } from "../middleware/auth.ts";

export const emails = Router();

// POST /api/emails/send   Body (optional): { "userId": "<uuid>" } - defaults to the caller.
// Queuing for someone else needs owner/admin in the same workspace. apps/worker does the send.
emails.post("/send", requireUser, async (req, res) => {
  const me = (req as AuthedRequest).user;
  const userId: string = req.body?.userId ?? me.id;

  if (userId !== me.id) {
    const { data: rows } = await supabaseAdmin()
      .from("members")
      .select("user_id, workspace_id, level")
      .in("user_id", [me.id, userId]);
    const caller = rows?.find((r) => r.user_id === me.id);
    const target = rows?.find((r) => r.user_id === userId);
    const allowed = caller && target && caller.workspace_id === target.workspace_id
      && (caller.level === "owner" || caller.level === "admin");
    if (!allowed) return void res.status(403).json({ error: "forbidden" });
  }

  const job = await enqueueUserEmails(userId);
  res.status(202).json({ queued: true, jobId: job.id, userId });
});
