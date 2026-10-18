import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase.ts";
import { HttpError, must, parse } from "../lib/http.ts";
import { can, canManageTeam, ctxOf, requireMember } from "../middleware/auth.ts";
import { settingsToDb } from "../lib/dto.ts";
import { loadWorkspace } from "../lib/workspace.ts";

export const workspace = Router();
workspace.use(requireMember);

const Level = z.object({
  target: z.enum(["assignee", "next", "backup", "manager"]),
  seconds: z.number().int().min(5).max(7 * 86400),
});
const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  settings: z.object({
    maxOpenLeads: z.number().int().min(1).max(1000).optional(),
    idleSeconds: z.number().int().min(10).max(30 * 86400).optional(),
    backupId: z.string().uuid().nullable().optional(),
    managerId: z.string().uuid().nullable().optional(),
    ackedOnAbsence: z.enum(["keep", "reassign"]).optional(),
    levels: z.array(Level).min(1).max(8).optional(),
  }).strict().optional(),
}).strict();

// Rename needs team management; assignment/escalation settings need assignment.manage (F3.3, F3.5).
workspace.patch("/", async (req, res) => {
  const ctx = ctxOf(req);
  const b = parse(Patch, req.body);
  if (b.name !== undefined && !canManageTeam(ctx)) throw new HttpError(403, "Only the Owner and Admins can rename the workspace.");
  if (b.settings && !can(ctx, "assignment.manage")) throw new HttpError(403, "You need the \"manage assignment rules\" permission.");

  const s = b.settings ?? {};
  // backup and manager must be members of this workspace
  const ids = [s.backupId, s.managerId].filter((x): x is string => !!x);
  if (ids.length) {
    const { count } = await supabaseAdmin().from("members").select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.member.workspaceId).in("id", ids);
    if ((count ?? 0) !== new Set(ids).size) throw new HttpError(400, "Backup and manager must be members of this workspace.");
  }
  must(await supabaseAdmin().rpc("api_update_workspace", {
    p_actor: ctx.member.id, p_ws: ctx.member.workspaceId, p_name: b.name ?? null, p_settings: settingsToDb(s),
  }));
  res.json(await loadWorkspace(ctx.member.workspaceId, ctx.member.id));
});
