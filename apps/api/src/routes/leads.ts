// M4: lead engine API. Assignment, escalation timers and absence handling live in Postgres
// (assign_lead, escalate_expired_leads via pg_cron, set_member_status) — this file only creates
// leads, exposes them, and forwards acknowledge / reassign with the acting member recorded.
// Mounted at /api: guards are per route, never router.use.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Perm } from "@nascon/ui";
import { supabaseAdmin } from "../lib/supabase.ts";
import { HttpError, dbError, must, parse } from "../lib/http.ts";
import { can, ctxOf, requireMember, requirePerm, type Ctx } from "../middleware/auth.ts";
import { logActivity } from "../lib/crm.ts";

export const leads = Router();
const allow = (p: Perm) => [requireMember, requirePerm(p)] as const;
const Id = z.object({ id: z.string().uuid("Unknown lead.") });

type LeadRow = {
  id: string; contact_id: string; source: string; status: "unacknowledged" | "acknowledged" | "closed"; owner_id: string | null;
  assigned_at: string | null; first_assigned_at: string | null; ack_deadline: string | null; acknowledged_at: string | null;
  escalation_level: number; escalation_count: number; recovery_flag: string | null; last_action_at: string; created_at: string;
};
type AssignRow = { lead_id: string; from_member: string | null; to_member: string | null; reason: string; created_at: string };

const SOURCE_IN = { "web form": "web_form", web_form: "web_form", manual: "manual", whatsapp: "whatsapp", sms: "sms" } as const;
const SOURCE_OUT: Record<string, string> = { web_form: "web form", manual: "manual", whatsapp: "whatsapp", sms: "sms" };
const KIND: Record<string, "assign" | "escalate" | "reassign"> = { initial: "assign", escalation: "escalate", absence: "reassign", manual: "reassign" };
const WHY: Record<string, string> = {
  initial: "Round-robin among available employees", escalation: "Acknowledgement window expired",
  absence: "Owner went on leave / offline", manual: "Manually reassigned",
};
const ms = (t: string | null) => (t ? new Date(t).getTime() : null);

/** Leads in the shape the web app's lead screens use. */
function leadDto(l: LeadRow, history: AssignRow[]) {
  return {
    id: l.id, contactId: l.contact_id, source: SOURCE_OUT[l.source] ?? l.source, createdAt: ms(l.created_at)!,
    status: !l.owner_id ? "unassigned" : l.status === "unacknowledged" ? "assigned" : "acknowledged",
    ownerId: l.owner_id, assignedAt: ms(l.assigned_at), firstAssignedAt: ms(l.first_assigned_at),
    deadlineAt: l.status === "unacknowledged" ? ms(l.ack_deadline) : null,
    ackedAt: ms(l.acknowledged_at), ackedBy: l.acknowledged_at ? l.owner_id : null, lastActionAt: ms(l.last_action_at)!,
    level: l.escalation_level, escalations: l.escalation_count, exhausted: l.recovery_flag === "chain_exhausted",
    history: [
      ...history.map((h) => ({ at: ms(h.created_at)!, from: h.from_member, to: h.to_member, kind: KIND[h.reason] ?? "reassign", reason: WHY[h.reason] ?? h.reason })),
      ...(l.acknowledged_at ? [{ at: ms(l.acknowledged_at)!, from: l.owner_id, to: l.owner_id, kind: "acknowledge" as const, reason: "Acknowledged" }] : []),
    ].sort((a, b) => a.at - b.at),
  };
}

/** Owner/Admin and lead managers see every lead; everyone else sees the leads they own. */
const seesAll = (ctx: Ctx) => ctx.member.level !== "user" || can(ctx, "leads.manage") || can(ctx, "assignment.manage");

leads.get("/leads", requireMember, async (req, res) => {
  const ctx = ctxOf(req);
  const db = supabaseAdmin();
  let q = db.from("leads")
    .select("id, contact_id, source, status, owner_id, assigned_at, first_assigned_at, ack_deadline, acknowledged_at, escalation_level, escalation_count, recovery_flag, last_action_at, created_at")
    .eq("workspace_id", ctx.member.workspaceId).neq("status", "closed").order("created_at", { ascending: false }).limit(1000);
  if (!seesAll(ctx)) q = q.eq("owner_id", ctx.member.id);
  const rows = must(await q) as LeadRow[];
  const hist = rows.length
    ? must(await db.from("lead_assignments").select("lead_id, from_member, to_member, reason, created_at")
        .eq("workspace_id", ctx.member.workspaceId).in("lead_id", rows.map((r) => r.id)).order("id")) as AssignRow[]
    : [];
  res.json({ leads: rows.map((l) => leadDto(l, hist.filter((h) => h.lead_id === l.id))), serverTime: Date.now() });
});

/**
 * One way in for every source (F3.1): match the contact by phone or create it, then insert the lead.
 * The insert trigger assigns it round-robin (F3.3) and starts the acknowledgement window (F3.4).
 */
export async function createLead(ws: string, b: { name: string; phone: string; email?: string; note?: string; source: keyof typeof SOURCE_IN }, actor: string | null) {
  const db = supabaseAdmin();
  const source = SOURCE_IN[b.source];
  let contactId = (await db.from("contacts").select("id").eq("workspace_id", ws).eq("phone", b.phone).maybeSingle()).data?.id as string | undefined;
  if (!contactId) {
    const { data, error } = await db.from("contacts").insert({
      workspace_id: ws, full_name: b.name, phone: b.phone, email: b.email || null, source: SOURCE_OUT[source],
    }).select("id").single();
    if (error) throw dbError(error)!;
    contactId = data.id as string;
  }
  const lead = must(await db.from("leads").insert({ workspace_id: ws, contact_id: contactId, source, note: b.note || null }).select("id, owner_id").single()) as { id: string; owner_id: string | null };
  if (b.note) await logActivity(ws, actor, { contactId, type: "note", text: `${source === "web_form" ? "Web form" : "Lead note"}: ${b.note}` });
  return { leadId: lead.id, contactId, ownerId: lead.owner_id };
}

const Phone = z.string().trim().transform((p) => p.replace(/[\s()-]/g, "")).pipe(z.string().regex(/^\+?[0-9]{7,15}$/, "Enter a phone number with country code, e.g. +92 300 1234567."));
const LeadBody = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(160),
  phone: Phone,
  email: z.string().trim().toLowerCase().email("Enter a valid email.").or(z.literal("")).optional(),
  note: z.string().trim().max(2000).optional(),
});

// Manual entry (F3.1)
leads.post("/leads", ...allow("crm.create"), async (req, res) => {
  const ctx = ctxOf(req);
  const b = parse(LeadBody.strict(), req.body);
  res.status(201).json(await createLead(ctx.member.workspaceId, { ...b, source: "manual" }, ctx.member.id));
});

// F3.4: only the current owner can acknowledge
leads.post("/leads/:id/acknowledge", requireMember, async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  must(await supabaseAdmin().rpc("api_ack_lead", { p_actor: ctx.member.id, p_ws: ctx.member.workspaceId, p_lead: id }));
  res.json({ ok: true });
});

// Manual reassignment (managers); counted separately from automatic escalations
leads.post("/leads/:id/reassign", ...allow("assignment.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  const { to } = parse(z.object({ to: z.string().uuid("Pick a team member.") }).strict(), req.body);
  must(await supabaseAdmin().rpc("api_reassign_lead", { p_actor: ctx.member.id, p_ws: ctx.member.workspaceId, p_lead: id, p_to: to }));
  res.json({ ok: true });
});

/* ---- public web form (no login): tight rate limit, validation, honeypot (Q3) ---- */

const publicLimit = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many submissions. Please wait a minute and try again." } });
const Ws = z.object({ workspaceId: z.string().uuid("Unknown form.") });

leads.get("/public/workspaces/:workspaceId", async (req, res) => {
  const { workspaceId } = parse(Ws, req.params);
  const { data } = await supabaseAdmin().from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
  if (!data) throw new HttpError(404, "This form is not active.");
  res.json({ name: data.name });
});

leads.post("/public/capture/:workspaceId", publicLimit, async (req, res) => {
  const { workspaceId } = parse(Ws, req.params);
  const b = parse(LeadBody.extend({ website: z.string().max(200).optional() }).strict(), req.body);
  if (b.website) return void res.status(201).json({ ok: true });   // honeypot filled = bot; pretend success
  const { data } = await supabaseAdmin().from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (!data) throw new HttpError(404, "This form is not active.");
  await createLead(workspaceId, { name: b.name, phone: b.phone, email: b.email, note: b.note, source: "web form" }, null);
  res.status(201).json({ ok: true });
});
