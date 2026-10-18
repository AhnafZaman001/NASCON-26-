// CRM rows (DB) -> shapes apps/web uses. Opportunity values are masked here for callers without
// values.view (F1.4): the service role bypasses opportunities_v, so the API must do it itself.
import { supabaseAdmin } from "./supabase.ts";
import { HttpError, must } from "./http.ts";

export type CompanyRow = { id: string; name: string; domain: string | null; industry: string | null; created_at: string };
export type ContactRow = {
  id: string; company_id: string | null; owner_id: string | null; full_name: string; email: string | null; phone: string | null;
  tags: string[]; opted_out: boolean; source: string | null; custom: Record<string, string>; created_at: string;
};
export type OppRow = {
  id: string; contact_id: string; pipeline_id: string; stage_id: string; title: string; value: number | string;
  currency: string; owner_id: string | null; custom: Record<string, string>; payment_status: string; version: number; created_at: string;
};
export type ActivityRow = {
  id: number; contact_id: string | null; opportunity_id: string | null; actor_id: string | null; type: string;
  data: Record<string, unknown>; created_at: string;
};

export const COMPANY_COLS = "id, name, domain, industry, created_at";
export const CONTACT_COLS = "id, company_id, owner_id, full_name, email, phone, tags, opted_out, source, custom, created_at";
export const OPP_COLS = "id, contact_id, pipeline_id, stage_id, title, value, currency, owner_id, custom, payment_status, version, created_at";
export const ACTIVITY_COLS = "id, contact_id, opportunity_id, actor_id, type, data, created_at";

const ms = (t: string) => new Date(t).getTime();

export const companyDto = (c: CompanyRow) => ({ id: c.id, name: c.name, domain: c.domain, industry: c.industry });

export const contactDto = (c: ContactRow) => ({
  id: c.id, name: c.full_name, phone: c.phone ?? "", email: c.email ?? "", companyId: c.company_id, ownerId: c.owner_id,
  tags: c.tags ?? [], optedOut: c.opted_out, custom: c.custom ?? {}, createdAt: ms(c.created_at), source: c.source ?? "manual",
});

export const oppDto = (o: OppRow, seeValues: boolean) => ({
  id: o.id, title: o.title, contactId: o.contact_id, pipelineId: o.pipeline_id, stageId: o.stage_id,
  value: seeValues ? Number(o.value) : 0, valueHidden: !seeValues, currency: o.currency, ownerId: o.owner_id,
  custom: o.custom ?? {}, paymentStatus: o.payment_status, version: o.version, createdAt: ms(o.created_at),
});

// activities.type in the DB -> the UI's activity kinds
const KIND: Record<string, string> = {
  note: "note", stage_change: "stage", assignment: "assignment", field_edit: "field",
  message: "message", payment: "payment", appointment: "appointment",
};
export const activityDto = (a: ActivityRow) => ({
  id: `srv_${a.id}`, contactId: a.contact_id ?? "", oppId: a.opportunity_id ?? undefined, at: ms(a.created_at),
  actor: a.actor_id ?? "system", type: KIND[a.type] ?? "lead",
  text: typeof a.data?.text === "string" ? a.data.text : typeof a.data?.reason === "string" ? `${a.type.replace(/_/g, " ")}: ${a.data.reason}` : a.type.replace(/_/g, " "),
});

/** Append one entry to a contact/opportunity's activity history (F2.7). */
export async function logActivity(ws: string, actor: string | null,
  a: { contactId?: string | null; oppId?: string | null; type: keyof typeof KIND; text: string }) {
  must(await supabaseAdmin().from("activities").insert({
    workspace_id: ws, contact_id: a.contactId ?? null, opportunity_id: a.oppId ?? null, actor_id: actor, type: a.type, data: { text: a.text },
  }));
}

/** Custom field values must use this workspace's field ids for the right entity. Returns field names by id. */
export async function checkCustom(ws: string, entity: "contact" | "opportunity", custom: Record<string, string>) {
  const ids = Object.keys(custom);
  if (!ids.length) return new Map<string, string>();
  const rows = must(await supabaseAdmin().from("field_definitions").select("id, name, entity")
    .eq("workspace_id", ws).in("id", ids)) as { id: string; name: string; entity: string }[];
  const ok = new Map(rows.filter((r) => r.entity === entity).map((r) => [r.id, r.name]));
  const bad = ids.filter((id) => !ok.has(id));
  if (bad.length) throw new HttpError(400, "Unknown custom field for this record.");
  return ok;
}

/** 404 unless the row exists in this workspace (guessed ids reveal nothing, F1.6). */
const WHAT: Record<string, string> = { contacts: "Contact", companies: "Company", opportunities: "Opportunity", pipelines: "Pipeline", members: "Member" };
export async function getOwned<T = { id: string }>(ctx: { member: { workspaceId: string } }, id: string, table: keyof typeof WHAT, cols = "id"): Promise<T> {
  const { data } = await supabaseAdmin().from(table).select(cols).eq("id", id).eq("workspace_id", ctx.member.workspaceId).maybeSingle();
  if (!data) throw new HttpError(404, `${WHAT[table]} not found.`);
  return data as T;
}

/** Everything the CRM screens need in one call (pipelines, fields, records, recent history). */
export async function loadCrm(ws: string, seeValues: boolean) {
  const db = supabaseAdmin();
  const [companies, contacts, opps, pipelines, stages, required, fields, activities, lists, messages, twilio] = await Promise.all([
    db.from("companies").select(COMPANY_COLS).eq("workspace_id", ws).order("name").limit(2000),
    db.from("contacts").select(CONTACT_COLS).eq("workspace_id", ws).order("created_at", { ascending: false }).limit(5000),
    db.from("opportunities").select(OPP_COLS).eq("workspace_id", ws).order("created_at", { ascending: false }).limit(5000),
    db.from("pipelines").select("id, name, position").eq("workspace_id", ws).order("position"),
    db.from("stages").select("id, pipeline_id, name, position, kind").eq("workspace_id", ws).order("position"),
    db.from("stage_required_fields").select("stage_id, field_id").eq("workspace_id", ws),
    db.from("field_definitions").select("id, name, type, entity, pipeline_id, options, position").eq("workspace_id", ws).order("position"),
    db.from("activities").select(ACTIVITY_COLS).eq("workspace_id", ws).order("id", { ascending: false }).limit(1000),
    db.from("saved_lists").select("id, name, filters").eq("workspace_id", ws).order("created_at"),
    db.from("messages").select("id, contact_id, direction, body, status, error, sent_by, provider_sid, created_at").eq("workspace_id", ws).order("created_at").limit(2000),
    db.from("integrations").select("status").eq("workspace_id", ws).eq("provider", "twilio").maybeSingle(),
  ]);
  const st = must(stages) as { id: string; pipeline_id: string; name: string; kind: "open" | "won" | "lost" }[];
  const req = must(required) as { stage_id: string; field_id: string }[];
  return {
    companies: (must(companies) as CompanyRow[]).map(companyDto),
    contacts: (must(contacts) as ContactRow[]).map(contactDto),
    opps: (must(opps) as OppRow[]).map((o) => oppDto(o, seeValues)),
    pipelines: (must(pipelines) as { id: string; name: string }[]).map((p) => ({
      id: p.id, name: p.name,
      stages: st.filter((s) => s.pipeline_id === p.id).map((s) => ({
        id: s.id, name: s.name, kind: s.kind, required: req.filter((r) => r.stage_id === s.id).map((r) => r.field_id),
      })),
    })),
    fields: (must(fields) as { id: string; name: string; type: string; entity: string; pipeline_id: string | null; options: unknown }[])
      .filter((f) => f.entity !== "company")
      .map((f) => ({ id: f.id, name: f.name, type: f.type, entity: f.entity, pipelineId: f.pipeline_id, options: Array.isArray(f.options) ? f.options : [] })),
    activity: (must(activities) as ActivityRow[]).map(activityDto),
    lists: (must(lists) as { id: string; name: string; filters: unknown }[]).map((l) => ({ id: l.id, name: l.name, criteria: Array.isArray(l.filters) ? l.filters : [] })),
    messages: (must(messages) as { id: string; contact_id: string; direction: string; body: string; status: string; error: string | null; sent_by: string | null; provider_sid: string | null; created_at: string }[]).map((m) => ({
      id: m.id, contactId: m.contact_id, direction: m.direction === "inbound" ? "in" : "out", body: m.body, at: ms(m.created_at),
      status: m.status === "read" ? "delivered" : m.status, error: m.error ?? undefined, by: m.sent_by ?? undefined, ref: m.provider_sid ?? m.id,
    })),
    messagingStatus: process.env.TWILIO_ACCOUNT_SID ? ((twilio.data?.status as string) === "error" ? "error" : "connected") : "not_connected",
  };
}
