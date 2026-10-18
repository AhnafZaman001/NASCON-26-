import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase.ts";
import { HttpError, dbError, must, parse } from "../lib/http.ts";
import { can, ctxOf, requireMember, requireTeamManager, type Ctx } from "../middleware/auth.ts";
import { toDbStatus } from "../lib/dto.ts";
import { loadWorkspace } from "../lib/workspace.ts";

export const members = Router();
members.use(requireMember);

const Id = z.object({ id: z.string().uuid("Unknown member.") });

/** Load a member of the caller's workspace (404 otherwise, so guessed ids reveal nothing). */
async function target(ctx: Ctx, id: string) {
  const { data } = await supabaseAdmin().from("members").select("id, level, user_id")
    .eq("id", id).eq("workspace_id", ctx.member.workspaceId).maybeSingle();
  if (!data) throw new HttpError(404, "Member not found.");
  return data as { id: string; level: "owner" | "admin" | "user"; user_id: string };
}

/** F1.2: nobody touches the Owner; only the Owner touches Admins. */
function assertCanModify(ctx: Ctx, t: { level: string }) {
  if (t.level === "owner") throw new HttpError(403, "The Owner can't be modified.");
  if (t.level === "admin" && ctx.member.level !== "owner") throw new HttpError(403, "Only the Owner can change an Admin.");
}

const Invite = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  level: z.enum(["admin", "user"]),
  roleId: z.string().uuid().nullable(),
}).strict();

// F1.2: Owner/Admin invites a user. Creates their login with a one-time temporary password.
members.post("/", requireTeamManager, async (req, res) => {
  const ctx = ctxOf(req);
  const b = parse(Invite, req.body);
  if (b.level === "admin" && ctx.member.level !== "owner") throw new HttpError(403, "Only the Owner can add Admins.");
  const db = supabaseAdmin();
  const tempPassword = randomBytes(9).toString("base64url");
  const { data, error } = await db.auth.admin.createUser({
    email: b.email, password: tempPassword, email_confirm: true, user_metadata: { full_name: b.name },
  });
  if (error || !data.user) {
    if (/already|exists|registered/i.test(error?.message ?? "")) throw new HttpError(409, "This email already has an account.");
    throw new HttpError(400, error?.message ?? "Could not create the account.");
  }
  const add = await db.rpc("api_add_member", {
    p_actor: ctx.member.id, p_ws: ctx.member.workspaceId, p_user: data.user.id,
    p_email: b.email, p_name: b.name, p_level: b.level, p_role: b.roleId,
  });
  if (add.error) { await db.auth.admin.deleteUser(data.user.id); throw dbError(add.error)!; }
  res.status(201).json({ ...(await loadWorkspace(ctx.member.workspaceId, ctx.member.id)), invited: { email: b.email, tempPassword } });
});

const Patch = z.object({
  level: z.enum(["admin", "user"]).optional(),
  roleId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120).optional(),
}).strict();

members.patch("/:id", requireTeamManager, async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  const b = parse(Patch, req.body);
  const t = await target(ctx, id);
  assertCanModify(ctx, t);
  if (b.level === "admin" && ctx.member.level !== "owner") throw new HttpError(403, "Only the Owner can make someone an Admin.");
  const patch: Record<string, unknown> = {};
  if (b.level !== undefined) patch.level = b.level;
  if (b.roleId !== undefined) patch.role_id = b.roleId;
  if (b.name !== undefined) patch.full_name = b.name;
  must(await supabaseAdmin().rpc("api_update_member", { p_actor: ctx.member.id, p_ws: ctx.member.workspaceId, p_member: id, p_patch: patch }));
  res.json(await loadWorkspace(ctx.member.workspaceId, ctx.member.id));
});

members.delete("/:id", requireTeamManager, async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  const t = await target(ctx, id);
  assertCanModify(ctx, t);
  if (t.id === ctx.member.id) throw new HttpError(400, "You can't remove yourself.");
  const userId = must(await supabaseAdmin().rpc("api_remove_member", { p_actor: ctx.member.id, p_ws: ctx.member.workspaceId, p_member: id })) as string;
  await supabaseAdmin().auth.admin.deleteUser(userId);   // also ends their sessions
  res.json(await loadWorkspace(ctx.member.workspaceId, ctx.member.id));
});

const Status = z.object({ status: z.enum(["available", "busy", "leave", "offline"]) }).strict();

// F3.2 / F3.6: an employee sets their own status; Owner/Admin or assignment.manage set anyone's.
members.post("/:id/status", async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  const { status } = parse(Status, req.body);
  await target(ctx, id);
  if (id !== ctx.member.id && ctx.member.level === "user" && !can(ctx, "assignment.manage")) {
    throw new HttpError(403, "You can only change your own status.");
  }
  const reassigned = must(await supabaseAdmin().rpc("api_set_member_status", {
    p_actor: ctx.member.id, p_ws: ctx.member.workspaceId, p_member: id, p_status: toDbStatus(status),
  })) as number;
  res.json({ ...(await loadWorkspace(ctx.member.workspaceId, ctx.member.id)), reassigned });
});
