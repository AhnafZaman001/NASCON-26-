import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase.ts";
import { must, parse } from "../lib/http.ts";
import { ctxOf, requireMember } from "../middleware/auth.ts";
import { loadWorkspace } from "../lib/workspace.ts";

export const me = Router();
me.use(requireMember);

// Boot payload: workspace, my member id, team, roles, settings.
me.get("/", async (req, res) => {
  const { member } = ctxOf(req);
  res.json(await loadWorkspace(member.workspaceId, member.id));
});

const MePatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  notifyDest: z.string().trim().max(200).optional(),
  hiddenTiles: z.array(z.string().max(40)).max(40).optional(),
}).strict();

// Own profile: name, alert destination (I4.3), dashboard tiles (F5.5)
me.patch("/", async (req, res) => {
  const { member } = ctxOf(req);
  const b = parse(MePatch, req.body);
  const patch: Record<string, unknown> = {};
  if (b.name !== undefined) patch.full_name = b.name;
  if (b.notifyDest !== undefined) patch.notify_destination = b.notifyDest;
  if (b.hiddenTiles !== undefined) patch.dashboard_prefs = { hidden: b.hiddenTiles };
  must(await supabaseAdmin().rpc("api_update_member", { p_actor: member.id, p_ws: member.workspaceId, p_member: member.id, p_patch: patch }));
  res.json(await loadWorkspace(member.workspaceId, member.id));
});
