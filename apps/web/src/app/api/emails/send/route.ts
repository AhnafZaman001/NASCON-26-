import { enqueueUserEmails } from "@nascon/queue";

// POST /api/emails/send   Authorization: Bearer <supabase access token>
// Body (optional): { "userId": "<uuid>" } - defaults to the caller. Queuing for someone else
// needs owner/admin in the same workspace. The worker (apps/worker) does the actual send.
export async function POST(request: Request) {
  // Lazy: the admin client throws at import time when SUPABASE_SECRET_KEY is unset (e.g. during build).
  const { supabaseAdmin } = await import("@/lib/supabase-admin");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "missing bearer token" }, { status: 401 });

  const { data: auth, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !auth.user) return Response.json({ error: "invalid token" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { userId?: string };
  const userId = body.userId ?? auth.user.id;

  if (userId !== auth.user.id) {
    const { data: rows } = await supabaseAdmin
      .from("members")
      .select("user_id, workspace_id, level")
      .in("user_id", [auth.user.id, userId]);
    const me = rows?.find((r) => r.user_id === auth.user.id);
    const target = rows?.find((r) => r.user_id === userId);
    const allowed = me && target && me.workspace_id === target.workspace_id && (me.level === "owner" || me.level === "admin");
    if (!allowed) return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const job = await enqueueUserEmails(userId);
  return Response.json({ queued: true, jobId: job.id, userId }, { status: 202 });
}
