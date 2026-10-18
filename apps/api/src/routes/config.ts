// M3: CRM customization — pipelines, stages, custom fields, stage-required fields, saved lists.
// Writes go through the api_* SQL functions (0016) so audit rows name the member (F4.1).
// Mounted at /api, so guards are per route (allow()), never router.use.
import { Router } from "express";
import { z } from "zod";
import type { Perm } from "@nascon/ui";
import { supabaseAdmin } from "../lib/supabase.ts";
import { HttpError, must, parse } from "../lib/http.ts";
import { ctxOf, requireMember, requirePerm } from "../middleware/auth.ts";

export const config = Router();
const allow = (p: Perm) => [requireMember, requirePerm(p)] as const;
const Id = z.object({ id: z.string().uuid("Unknown record.") });
const Name = z.string().trim().min(1, "Enter a name.").max(80);

const rpc = async (fn: string, args: Record<string, unknown>) => { must(await supabaseAdmin().rpc(fn, args)); };
const base = (req: Parameters<typeof ctxOf>[0]) => { const { member } = ctxOf(req); return { p_actor: member.id, p_ws: member.workspaceId }; };

/* ---- pipelines & stages (F2.5) ---- */

config.post("/pipelines", ...allow("pipelines.manage"), async (req, res) => {
  const b = parse(z.object({ id: z.string().uuid(), name: Name, stageIds: z.array(z.string().uuid()).length(3) }).strict(), req.body);
  await rpc("api_add_pipeline", { ...base(req), p_id: b.id, p_name: b.name, p_stage_ids: b.stageIds });
  res.status(201).json({ ok: true });
});

config.post("/pipelines/:id/stages", ...allow("pipelines.manage"), async (req, res) => {
  const { id } = parse(Id, req.params);
  const b = parse(z.object({ id: z.string().uuid(), name: Name }).strict(), req.body);
  await rpc("api_add_stage", { ...base(req), p_pipeline: id, p_id: b.id, p_name: b.name });
  res.status(201).json({ ok: true });
});

config.put("/pipelines/:id/stage-order", ...allow("pipelines.manage"), async (req, res) => {
  const { id } = parse(Id, req.params);
  const b = parse(z.object({ ids: z.array(z.string().uuid()).min(2).max(50) }).strict(), req.body);
  await rpc("api_reorder_stages", { ...base(req), p_pipeline: id, p_ids: b.ids });
  res.json({ ok: true });
});

config.patch("/stages/:id", ...allow("pipelines.manage"), async (req, res) => {
  const { id } = parse(Id, req.params);
  const b = parse(z.object({ name: Name }).strict(), req.body);
  await rpc("api_rename_stage", { ...base(req), p_stage: id, p_name: b.name });
  res.json({ ok: true });
});

// Deleting a stage that still holds deals needs moveTo; the database refuses otherwise.
config.delete("/stages/:id", ...allow("pipelines.manage"), async (req, res) => {
  const { id } = parse(Id, req.params);
  const b = parse(z.object({ moveTo: z.string().uuid().optional() }), req.query);
  await rpc("api_delete_stage", { ...base(req), p_stage: id, p_move_to: b.moveTo ?? null });
  res.json({ ok: true });
});

// F2.4: the stage's required fields, replaced as a whole set
config.put("/stages/:id/required-fields", ...allow("pipelines.manage"), async (req, res) => {
  const { id } = parse(Id, req.params);
  const b = parse(z.object({ fieldIds: z.array(z.string().uuid()).max(50) }).strict(), req.body);
  await rpc("api_set_required", { ...base(req), p_stage: id, p_fields: b.fieldIds });
  res.json({ ok: true });
});

/* ---- custom fields (F2.2, F2.3) ---- */

const Field = z.object({
  id: z.string().uuid(),
  name: Name,
  type: z.enum(["text", "number", "date", "dropdown", "checkbox"]),
  entity: z.enum(["contact", "opportunity"]),
  pipelineId: z.string().uuid().nullable(),
  options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
}).strict().refine((f) => f.type !== "dropdown" || (f.options?.length ?? 0) > 0, { message: "A dropdown needs at least one option.", path: ["options"] });

config.post("/fields", ...allow("pipelines.manage"), async (req, res) => {
  const b = parse(Field, req.body);
  await rpc("api_add_field", {
    ...base(req), p_id: b.id, p_entity: b.entity, p_pipeline: b.pipelineId, p_name: b.name, p_type: b.type,
    p_options: b.type === "dropdown" ? b.options : [],
  });
  res.status(201).json({ ok: true });
});

config.delete("/fields/:id", ...allow("pipelines.manage"), async (req, res) => {
  const { id } = parse(Id, req.params);
  await rpc("api_delete_field", { ...base(req), p_id: id });
  res.json({ ok: true });
});

/* ---- saved lists (F2.6): criteria are stored, not results, so lists update themselves ---- */

const Criterion = z.object({ field: z.enum(["tag", "stage", "owner", "source", "createdDays"]), value: z.string().max(100) }).strict();

config.post("/lists", ...allow("crm.view"), async (req, res) => {
  const { member } = ctxOf(req);
  const b = parse(z.object({ id: z.string().uuid(), name: Name, criteria: z.array(Criterion).min(1).max(10) }).strict(), req.body);
  must(await supabaseAdmin().from("saved_lists").insert({
    id: b.id, workspace_id: member.workspaceId, owner_id: member.id, name: b.name, entity: "contact", filters: b.criteria,
  }));
  res.status(201).json({ ok: true });
});

config.delete("/lists/:id", ...allow("crm.view"), async (req, res) => {
  const { member } = ctxOf(req);
  const { id } = parse(Id, req.params);
  const { data } = await supabaseAdmin().from("saved_lists").select("owner_id").eq("id", id).eq("workspace_id", member.workspaceId).maybeSingle();
  if (!data) throw new HttpError(404, "List not found.");
  if (data.owner_id !== member.id && member.level === "user") throw new HttpError(403, "Only the list's creator or an Admin can delete it.");
  must(await supabaseAdmin().from("saved_lists").delete().eq("id", id).eq("workspace_id", member.workspaceId));
  res.json({ ok: true });
});
