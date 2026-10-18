import { Router } from "express";
import { z } from "zod";
import { ALL_PERM_KEYS, type Perm } from "@nascon/ui";
import { supabaseAdmin } from "../lib/supabase.ts";
import { must, parse } from "../lib/http.ts";
import { ctxOf, requireMember, requireTeamManager } from "../middleware/auth.ts";
import { loadWorkspace } from "../lib/workspace.ts";

// F1.3: roles are named permission sets; a "Manager" is just a role, not a hard-coded level.
export const roles = Router();
roles.use(requireMember, requireTeamManager);

const PermEnum = z.enum(ALL_PERM_KEYS as [Perm, ...Perm[]]);
const Body = z.object({
  name: z.string().trim().min(1, "Enter a role name.").max(60),
  perms: z.array(PermEnum).max(ALL_PERM_KEYS.length),
}).strict();
const Id = z.object({ id: z.string().uuid("Unknown role.") });

roles.post("/", async (req, res) => {
  const ctx = ctxOf(req);
  const b = parse(Body, req.body);
  must(await supabaseAdmin().rpc("api_save_role", { p_actor: ctx.member.id, p_ws: ctx.member.workspaceId, p_role: null, p_name: b.name, p_perms: b.perms }));
  res.status(201).json(await loadWorkspace(ctx.member.workspaceId, ctx.member.id));
});

roles.patch("/:id", async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  const b = parse(Body.partial(), req.body);
  must(await supabaseAdmin().rpc("api_save_role", {
    p_actor: ctx.member.id, p_ws: ctx.member.workspaceId, p_role: id, p_name: b.name ?? null, p_perms: b.perms ?? null,
  }));
  res.json(await loadWorkspace(ctx.member.workspaceId, ctx.member.id));
});

roles.delete("/:id", async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  must(await supabaseAdmin().rpc("api_delete_role", { p_actor: ctx.member.id, p_ws: ctx.member.workspaceId, p_role: id }));
  res.json(await loadWorkspace(ctx.member.workspaceId, ctx.member.id));
});
