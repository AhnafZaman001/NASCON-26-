// M2: CRM core records. Companies -> contacts -> opportunities, activity history, timeline, CSV export.
// Every route: requireMember, a permission guard, workspace-scoped queries, zod-validated input.
import { Router, type Response } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase.ts";
import { HttpError, dbError, must, parse } from "../lib/http.ts";
import type { Perm } from "@nascon/ui";
import { can, ctxOf, requireMember, requirePerm, type Ctx } from "../middleware/auth.ts";
import {
  ACTIVITY_COLS, COMPANY_COLS, CONTACT_COLS, OPP_COLS, activityDto, checkCustom, companyDto, contactDto, getOwned,
  loadCrm, logActivity, oppDto, type ActivityRow, type CompanyRow, type ContactRow, type OppRow,
} from "../lib/crm.ts";

export const crm = Router();
// Guards are per route (not crm.use) because this router is mounted at /api and must not touch other paths.
const allow = (p: Perm) => [requireMember, requirePerm(p)] as const;

const Id = z.object({ id: z.string().uuid("Unknown record.") });
const optText = (max: number) => z.string().trim().max(max).optional();
const Custom = z.record(z.string().uuid(), z.string().max(500)).optional();
const seeValues = (ctx: Ctx) => can(ctx, "values.view");

// Glossary: a recorded action by the owner (note, stage change) acknowledges their open leads on the contact.
const touchLeads = async (ctx: Ctx, contactId: string) => {
  await supabaseAdmin().rpc("api_touch_contact_leads", { p_actor: ctx.member.id, p_ws: ctx.member.workspaceId, p_contact: contactId });
};

async function deleteRecord(ctx: Ctx, kind: "contact" | "company" | "opportunity", id: string) {
  must(await supabaseAdmin().rpc("api_delete_crm", { p_actor: ctx.member.id, p_ws: ctx.member.workspaceId, p_kind: kind, p_id: id }));
}

/* ---------------- snapshot ---------------- */

crm.get("/crm", ...allow("crm.view"), async (req, res) => {
  const ctx = ctxOf(req);
  res.json(await loadCrm(ctx.member.workspaceId, seeValues(ctx)));
});

/* ---------------- companies ---------------- */

const CompanyBody = z.object({
  id: z.string().uuid().optional(),   // client-generated so optimistic UI and server agree on the id
  name: z.string().trim().min(1, "Enter a company name.").max(160),
  domain: optText(200), industry: optText(120),
}).strict();

crm.post("/companies", ...allow("crm.create"), async (req, res) => {
  const ctx = ctxOf(req);
  const b = parse(CompanyBody, req.body);
  const row = must(await supabaseAdmin().from("companies").insert({
    ...(b.id ? { id: b.id } : {}), workspace_id: ctx.member.workspaceId, name: b.name, domain: b.domain || null, industry: b.industry || null,
  }).select(COMPANY_COLS).single()) as CompanyRow;
  res.status(201).json({ company: companyDto(row) });
});

crm.patch("/companies/:id", ...allow("crm.edit"), async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  const b = parse(CompanyBody.omit({ id: true }).partial(), req.body);
  await getOwned(ctx, id, "companies");
  const row = must(await supabaseAdmin().from("companies").update({
    ...(b.name !== undefined ? { name: b.name } : {}),
    ...(b.domain !== undefined ? { domain: b.domain || null } : {}),
    ...(b.industry !== undefined ? { industry: b.industry || null } : {}),
  }).eq("id", id).eq("workspace_id", ctx.member.workspaceId).select(COMPANY_COLS).single()) as CompanyRow;
  res.json({ company: companyDto(row) });
});

crm.delete("/companies/:id", ...allow("crm.delete"), async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  await deleteRecord(ctx, "company", id);
  res.json({ ok: true });
});

/* ---------------- contacts ---------------- */

const ContactCreate = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required.").max(160),
  phone: optText(40), email: z.string().trim().toLowerCase().email("Enter a valid email.").or(z.literal("")).optional(),
  companyId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30).optional(),
  source: optText(40), custom: Custom,
}).strict();
const ContactPatch = ContactCreate.omit({ id: true, source: true }).partial().extend({
  optedOut: z.boolean().optional(),
  ownerId: z.string().uuid().nullable().optional(),
}).strict();

async function assertCompany(ctx: Ctx, companyId: string | null | undefined) {
  if (companyId) await getOwned(ctx, companyId, "companies");
}
const phoneTaken = (e: { code?: string } | null) =>
  e?.code === "23505" ? new HttpError(409, "Another contact already has this phone number.") : dbError(e as never);

crm.post("/contacts", ...allow("crm.create"), async (req, res) => {
  const ctx = ctxOf(req);
  const b = parse(ContactCreate, req.body);
  await assertCompany(ctx, b.companyId);
  if (b.custom) await checkCustom(ctx.member.workspaceId, "contact", b.custom);
  const { data, error } = await supabaseAdmin().from("contacts").insert({
    ...(b.id ? { id: b.id } : {}), workspace_id: ctx.member.workspaceId, full_name: b.name, phone: b.phone || null,
    email: b.email || null, company_id: b.companyId ?? null, tags: b.tags ?? [], source: b.source || "manual",
    custom: b.custom ?? {}, owner_id: ctx.member.id,
  }).select(CONTACT_COLS).single();
  if (error) throw phoneTaken(error)!;
  await logActivity(ctx.member.workspaceId, ctx.member.id, { contactId: data.id, type: "field_edit", text: "Contact created" });
  res.status(201).json({ contact: contactDto(data as ContactRow) });
});

crm.patch("/contacts/:id", ...allow("crm.edit"), async (req, res) => {
  const ctx = ctxOf(req);
  const ws = ctx.member.workspaceId;
  const { id } = parse(Id, req.params);
  const b = parse(ContactPatch, req.body);
  const cur = await getOwned<ContactRow>(ctx, id, "contacts", CONTACT_COLS);
  if (b.ownerId !== undefined && !can(ctx, "assignment.manage")) throw new HttpError(403, "You need the \"manage assignment\" permission to change the owner.");
  if (b.ownerId) await getOwned(ctx, b.ownerId, "members");
  await assertCompany(ctx, b.companyId);
  const names = b.custom ? await checkCustom(ws, "contact", b.custom) : new Map<string, string>();

  const patch: Record<string, unknown> = {};
  const notes: { type: "field_edit" | "message" | "assignment"; text: string }[] = [];
  const set = (col: string, label: string, next: unknown, prev: unknown) => {
    if (next === undefined || JSON.stringify(next ?? null) === JSON.stringify(prev ?? null)) return;
    patch[col] = next; notes.push({ type: col === "owner_id" ? "assignment" : "field_edit", text: `${label} changed` });
  };
  set("full_name", "Name", b.name, cur.full_name);
  set("phone", "Phone", b.phone === undefined ? undefined : b.phone || null, cur.phone);
  set("email", "Email", b.email === undefined ? undefined : b.email || null, cur.email);
  set("company_id", "Company", b.companyId, cur.company_id);
  set("tags", "Tags", b.tags, cur.tags);
  set("owner_id", "Owner", b.ownerId, cur.owner_id);
  if (b.optedOut !== undefined && b.optedOut !== cur.opted_out) {
    patch.opted_out = b.optedOut;
    notes.push({ type: "message", text: b.optedOut ? "Marked as opted out of messaging" : "Opt-out removed" });
  }
  if (b.custom) {
    patch.custom = { ...cur.custom, ...b.custom };
    for (const [fid, v] of Object.entries(b.custom)) if ((cur.custom?.[fid] ?? "") !== v) notes.push({ type: "field_edit", text: `${names.get(fid)}: ${cur.custom?.[fid] || "empty"} → ${v || "empty"}` });
  }
  if (!Object.keys(patch).length) return void res.json({ contact: contactDto(cur) });

  const { data, error } = await supabaseAdmin().from("contacts").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id).eq("workspace_id", ws).select(CONTACT_COLS).single();
  if (error) throw phoneTaken(error)!;
  for (const n of notes) await logActivity(ws, ctx.member.id, { contactId: id, type: n.type, text: n.text });
  res.json({ contact: contactDto(data as ContactRow) });
});

crm.delete("/contacts/:id", ...allow("crm.delete"), async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  await deleteRecord(ctx, "contact", id);   // cascades opportunities, messages, payments, activities
  res.json({ ok: true });
});

const Note = z.object({ text: z.string().trim().min(1, "Write something first.").max(4000), oppId: z.string().uuid().optional() }).strict();

crm.post("/contacts/:id/notes", ...allow("crm.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  const b = parse(Note, req.body);
  await getOwned(ctx, id, "contacts");
  if (b.oppId) {
    const o = await getOwned<{ contact_id: string }>(ctx, b.oppId, "opportunities", "contact_id");
    if (o.contact_id !== id) throw new HttpError(400, "That opportunity belongs to another contact.");
  }
  await logActivity(ctx.member.workspaceId, ctx.member.id, { contactId: id, oppId: b.oppId, type: "note", text: b.text });
  await touchLeads(ctx, id);
  res.status(201).json({ ok: true });
});

// F2.7 / F2.8: one time-ordered history per contact (notes, stage changes, field edits, messages, payments, appointments)
crm.get("/contacts/:id/timeline", ...allow("crm.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const ws = ctx.member.workspaceId;
  const { id } = parse(Id, req.params);
  await getOwned(ctx, id, "contacts");
  const db = supabaseAdmin();
  const [acts, msgs, pays, appts] = await Promise.all([
    db.from("activities").select(ACTIVITY_COLS).eq("workspace_id", ws).eq("contact_id", id).order("id", { ascending: false }).limit(200),
    db.from("messages").select("id, direction, body, status, sent_by, created_at").eq("workspace_id", ws).eq("contact_id", id).order("created_at", { ascending: false }).limit(100),
    db.from("payments").select("id, opportunity_id, amount, currency, status, requested_by, created_at").eq("workspace_id", ws).eq("contact_id", id).order("created_at", { ascending: false }).limit(100),
    db.from("appointments").select("id, opportunity_id, member_id, title, starts_at, status, created_at").eq("workspace_id", ws).eq("contact_id", id).order("created_at", { ascending: false }).limit(100),
  ]);
  const ms = (t: string) => new Date(t).getTime();
  const items = [
    ...(must(acts) as ActivityRow[]).map(activityDto),
    ...(must(msgs) as { id: string; direction: string; body: string; status: string; sent_by: string | null; created_at: string }[]).map((m) => ({
      id: `msg_${m.id}`, contactId: id, at: ms(m.created_at), actor: m.direction === "inbound" ? "system" : m.sent_by ?? "system", type: "message",
      text: `${m.direction === "inbound" ? "Received" : "Sent"} (${m.status}): ${m.body.slice(0, 140)}`,
    })),
    ...(must(pays) as { id: string; opportunity_id: string; amount: number; currency: string; status: string; requested_by: string | null; created_at: string }[]).map((p) => ({
      id: `pay_${p.id}`, contactId: id, oppId: p.opportunity_id, at: ms(p.created_at), actor: p.requested_by ?? "system", type: "payment",
      text: `Payment ${p.status}: ${seeValues(ctx) ? `${Number(p.amount)} ${p.currency.toUpperCase()}` : "amount hidden"}`,
    })),
    ...(must(appts) as { id: string; opportunity_id: string | null; member_id: string; title: string; starts_at: string; status: string; created_at: string }[]).map((a) => ({
      id: `apt_${a.id}`, contactId: id, oppId: a.opportunity_id ?? undefined, at: ms(a.created_at), actor: a.member_id, type: "appointment",
      text: `Appointment ${a.status}: ${a.title} (${a.starts_at})`,
    })),
  ].sort((a, b) => b.at - a.at);
  res.json({ items });
});

/* ---------------- opportunities ---------------- */

const OppCreate = z.object({
  id: z.string().uuid().optional(),
  contactId: z.string().uuid(),
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid().optional(),   // default: the pipeline's first stage
  title: z.string().trim().min(1, "Enter a title.").max(200),
  value: z.number().min(0).max(1e12).optional(),
  currency: z.string().trim().toLowerCase().length(3).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  custom: Custom,
}).strict();
const OppPatch = z.object({
  version: z.number().int().positive("Reload and try again."),   // optimistic locking (Q4)
  title: z.string().trim().min(1).max(200).optional(),
  value: z.number().min(0).max(1e12).optional(),
  stageId: z.string().uuid().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  custom: Custom,
}).strict();

crm.post("/opportunities", ...allow("crm.create"), async (req, res) => {
  const ctx = ctxOf(req);
  const ws = ctx.member.workspaceId;
  const b = parse(OppCreate, req.body);
  await getOwned(ctx, b.contactId, "contacts");
  await getOwned(ctx, b.pipelineId, "pipelines");
  if (b.value && !seeValues(ctx)) throw new HttpError(403, "You can't set values without the \"see opportunity values\" permission.");
  if (b.ownerId && b.ownerId !== ctx.member.id && !can(ctx, "assignment.manage")) throw new HttpError(403, "You can only assign opportunities to yourself.");
  if (b.ownerId) await getOwned(ctx, b.ownerId, "members");
  if (b.custom) await checkCustom(ws, "opportunity", b.custom);
  const stageId = b.stageId ?? (must(await supabaseAdmin().from("stages").select("id").eq("workspace_id", ws)
    .eq("pipeline_id", b.pipelineId).order("position").limit(1).single()) as { id: string }).id;
  const row = must(await supabaseAdmin().from("opportunities").insert({
    ...(b.id ? { id: b.id } : {}), workspace_id: ws, contact_id: b.contactId, pipeline_id: b.pipelineId, stage_id: stageId,
    title: b.title, value: b.value ?? 0, currency: b.currency ?? "usd", owner_id: b.ownerId === undefined ? ctx.member.id : b.ownerId,
    custom: b.custom ?? {},
  }).select(OPP_COLS).single()) as OppRow;
  await logActivity(ws, ctx.member.id, { contactId: b.contactId, oppId: row.id, type: "stage_change", text: `Opportunity "${b.title}" created` });
  res.status(201).json({ opportunity: oppDto(row, seeValues(ctx)) });
});

crm.patch("/opportunities/:id", ...allow("crm.edit"), async (req, res) => {
  const ctx = ctxOf(req);
  const ws = ctx.member.workspaceId;
  const { id } = parse(Id, req.params);
  const b = parse(OppPatch, req.body);
  const cur = await getOwned<OppRow>(ctx, id, "opportunities", OPP_COLS);
  if (b.value !== undefined && !seeValues(ctx)) throw new HttpError(403, "You can't change values without the \"see opportunity values\" permission.");
  if (b.ownerId !== undefined && !can(ctx, "assignment.manage")) throw new HttpError(403, "You need the \"manage assignment\" permission to change the owner.");
  if (b.ownerId) await getOwned(ctx, b.ownerId, "members");
  const names = b.custom ? await checkCustom(ws, "opportunity", b.custom) : new Map<string, string>();

  const patch: Record<string, unknown> = {};
  const notes: { type: "stage_change" | "field_edit" | "assignment"; text: string }[] = [];
  if (b.title !== undefined && b.title !== cur.title) { patch.title = b.title; notes.push({ type: "field_edit", text: `Title: ${cur.title} → ${b.title}` }); }
  if (b.value !== undefined && b.value !== Number(cur.value)) { patch.value = b.value; notes.push({ type: "field_edit", text: `Value: ${Number(cur.value)} → ${b.value}` }); }
  if (b.ownerId !== undefined && b.ownerId !== cur.owner_id) { patch.owner_id = b.ownerId; notes.push({ type: "assignment", text: "Opportunity owner changed" }); }
  if (b.custom) {
    patch.custom = { ...cur.custom, ...b.custom };
    for (const [fid, v] of Object.entries(b.custom)) if ((cur.custom?.[fid] ?? "") !== v) notes.push({ type: "field_edit", text: `${names.get(fid)}: ${cur.custom?.[fid] || "empty"} → ${v || "empty"}` });
  }
  if (b.stageId !== undefined && b.stageId !== cur.stage_id) {
    const db = supabaseAdmin();
    const both = must(await db.from("stages").select("id, name").in("id", [cur.stage_id, b.stageId]).eq("workspace_id", ws)) as { id: string; name: string }[];
    if (!both.some((s) => s.id === b.stageId)) throw new HttpError(404, "Stage not found.");
    patch.stage_id = b.stageId;
    notes.push({ type: "stage_change", text: `Moved ${both.find((s) => s.id === cur.stage_id)?.name ?? "?"} → ${both.find((s) => s.id === b.stageId)?.name}` });
  }
  if (!Object.keys(patch).length) return void res.json({ opportunity: oppDto(cur, seeValues(ctx)) });

  // version check: 0 rows updated = someone saved first (the trigger bumps version on every update)
  const { data, error } = await supabaseAdmin().from("opportunities").update(patch)
    .eq("id", id).eq("workspace_id", ws).eq("version", b.version).select(OPP_COLS);
  if (error) throw dbError(error)!;   // P0001 from opportunity_guard = required fields missing (F2.4)
  if (!data?.length) throw new HttpError(409, "Someone else changed this opportunity. Reload to see their changes, then try again.");
  for (const n of notes) await logActivity(ws, ctx.member.id, { contactId: cur.contact_id, oppId: id, type: n.type, text: n.text });
  if (patch.stage_id) await touchLeads(ctx, cur.contact_id);
  res.json({ opportunity: oppDto(data[0] as OppRow, seeValues(ctx)) });
});

crm.delete("/opportunities/:id", ...allow("crm.delete"), async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  await deleteRecord(ctx, "opportunity", id);
  res.json({ ok: true });
});

/* ---------------- export (crm.export; values masked by the same rule, F1.4) ---------------- */

// Quote every cell and neutralise spreadsheet formulas (CSV injection).
const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/^[=+\-@\t\r]/, "'$&")}"`;
function sendCsv(res: Response, name: string, header: string[], rows: unknown[][]) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send([header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n"));
}

crm.get("/export/contacts.csv", ...allow("crm.export"), async (req, res) => {
  const ctx = ctxOf(req);
  const d = await loadCrm(ctx.member.workspaceId, seeValues(ctx));
  const co = new Map(d.companies.map((c) => [c.id, c.name]));
  sendCsv(res, "contacts.csv", ["Name", "Phone", "Email", "Company", "Tags", "Source", "Opted out", "Open value"],
    d.contacts.map((c) => [c.name, c.phone, c.email, co.get(c.companyId ?? "") ?? "", c.tags.join(";"), c.source, c.optedOut ? "yes" : "no",
      seeValues(ctx) ? d.opps.filter((o) => o.contactId === c.id).reduce((a, o) => a + o.value, 0) : "hidden"]));
});

crm.get("/export/opportunities.csv", ...allow("crm.export"), async (req, res) => {
  const ctx = ctxOf(req);
  const d = await loadCrm(ctx.member.workspaceId, seeValues(ctx));
  const contact = new Map(d.contacts.map((c) => [c.id, c.name]));
  const stage = new Map(d.pipelines.flatMap((p) => p.stages.map((s) => [s.id, `${p.name} / ${s.name}`] as const)));
  sendCsv(res, "opportunities.csv", ["Title", "Contact", "Stage", "Value", "Currency", "Payment status", "Created"],
    d.opps.map((o) => [o.title, contact.get(o.contactId) ?? "", stage.get(o.stageId) ?? "", seeValues(ctx) ? o.value : "hidden",
      o.currency.toUpperCase(), o.paymentStatus, new Date(o.createdAt).toISOString()]));
});
