"use client";
/**
 * Client data layer. Every mutation goes through the actions below, so the
 * Supabase/API swap point is this one file: replace each action body with a
 * server call and keep the signatures. Business rules (assignment, escalation,
 * permissions) are mirrored here so the UI behaves correctly in demo mode; the
 * server must enforce the same rules for real (see README).
 */
import { useSyncExternalStore } from "react";
import { uid, startOfDay } from "./utils";
import { blankWorkspace, defaultSettings, emptyState, makeSeed } from "./seed";
import type {
  Activity, Appointment, Availability, Contact, Criterion, CustomField, FieldType, IntegrationKey, Lead,
  Level, Member, Perm, State,
} from "./types";

const KEY = "nascon26.state.v1";
const SERVER = emptyState();
let state: State = SERVER;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ } };
function mutate(fn: (s: State) => void) { const n = structuredClone(state); fn(n); state = n; save(); emit(); }

export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useStore = () => useSyncExternalStore(subscribe, () => state, () => SERVER);
export const getState = () => state;

export function hydrate() {
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...JSON.parse(raw), hydrated: true } : makeSeed();
  } catch { state = makeSeed(); }
  save(); emit();
  window.addEventListener("storage", (e) => {
    if (e.key === KEY && e.newValue) { state = { ...JSON.parse(e.newValue), hydrated: true }; emit(); }
  });
}
export const resetDemo = () => { state = makeSeed(); save(); emit(); };

/* ---------- helpers ---------- */
const now = () => Date.now();
const member = (s: State, id: string | null | undefined) => s.members.find((m) => m.id === id) ?? null;
export const nameOf = (s: State, id: string | null | undefined) => (id === "system" ? "System" : member(s, id)?.name ?? "—");
const canDo = (s: State, p: Perm) => { const me = member(s, s.meId); return !!me && (me.level === "owner" || me.perms.includes(p)); };
const log = (s: State, type: string, target: string, before?: string, after?: string, actor?: string) =>
  s.audit.unshift({ id: uid("au"), at: now(), actor: actor ?? s.meId ?? "system", type, target, before, after });
const act = (s: State, a: Omit<Activity, "id" | "at" | "actor"> & { actor?: string }) =>
  s.activity.unshift({ id: uid("ac"), at: now(), actor: a.actor ?? s.meId ?? "system", ...a });
const sync = (s: State, integration: IntegrationKey, dir: "in" | "out", result: "ok" | "failed" | "rejected" | "duplicate", ref: string, note: string) => {
  s.sync.unshift({ id: uid("sy"), at: now(), integration, dir, result, ref, note });
  const i = s.integrations[integration];
  if (result === "ok") i.lastOk = now(); else if (result === "failed") i.errors.unshift({ at: now(), text: note });
  i.errors = i.errors.slice(0, 5); s.sync = s.sync.slice(0, 200);
};
const notify = (s: State, userId: string, text: string, leadId?: string) =>
  s.notifications.unshift({ id: uid("nt"), at: now(), userId, text, leadId, read: false });

export const openCount = (s: State, id: string) => s.leads.filter((l) => l.ownerId === id && l.status !== "unassigned").length;
const eligible = (s: State, m: Member, excl: string[]) => m.status === "available" && !excl.includes(m.id) && openCount(s, m.id) < s.settings.maxOpenLeads;
function pickNext(s: State, excl: string[]): Member | null {
  const n = s.members.length;
  for (let i = 1; i <= n; i++) { const m = s.members[(s.rr + i) % n]; if (eligible(s, m, excl)) { s.rr = (s.rr + i) % n; return m; } }
  return null;
}

/* ---------- lead engine ---------- */
function place(s: State, lead: Lead, owner: Member | null, kind: "assign" | "escalate" | "reassign", reason: string) {
  const t = now(); const from = lead.ownerId; const contact = s.contacts.find((c) => c.id === lead.contactId);
  lead.ownerId = owner?.id ?? null;
  if (!owner) { lead.status = "unassigned"; lead.deadlineAt = null; }
  else {
    lead.status = "assigned"; lead.assignedAt = t; lead.firstAssignedAt ??= t;
    lead.deadlineAt = t + (s.settings.levels[lead.level]?.seconds ?? 30) * 1000;
    notify(s, owner.id, `${kind === "escalate" ? "Escalated lead" : "New lead"}: ${contact?.name ?? "Unknown"} (${lead.source})`, lead.id);
  }
  lead.history.push({ at: t, from, to: lead.ownerId, kind, reason });
  if (contact) act(s, { contactId: contact.id, type: "assignment", actor: "system", text: owner ? `${kind === "escalate" ? "Escalated" : "Assigned"} to ${owner.name} - ${reason}` : `No eligible employee - ${reason}` });
  log(s, `lead.${kind === "assign" ? "assigned" : kind === "escalate" ? "escalated" : "reassigned"}`, contact?.name ?? lead.id, nameOf(s, from), owner?.name ?? "Unassigned", kind === "reassign" ? undefined : "system");
  if (kind === "escalate" && owner) {
    // F3.9 / I4: out-of-app alert
    const n = s.integrations.notifications;
    if (n.status === "connected") sync(s, "notifications", "out", "ok", uid("alert"), `Alert to ${owner.notifyDest}: "${contact?.name}" escalated (${reason}). Link /contacts/${lead.contactId}`);
    else sync(s, "notifications", "out", "failed", uid("alert"), `Could not alert ${owner.name}: notifications not connected`);
  }
}
function newLead(s: State, contactId: string, source: string) {
  const t = now();
  const lead: Lead = { id: uid("l"), contactId, source, createdAt: t, status: "unassigned", ownerId: null, assignedAt: null, firstAssignedAt: null, deadlineAt: null, ackedAt: null, ackedBy: null, lastActionAt: t, level: 0, escalations: 0, exhausted: false, history: [] };
  s.leads.unshift(lead);
  place(s, lead, pickNext(s, []), "assign", "Round-robin among available employees");
  return lead;
}
function escalate(s: State, lead: Lead, reason: string) {
  const prev = lead.history.map((h) => h.to).filter(Boolean) as string[];
  lead.level += 1; lead.escalations += 1;
  const lv = s.settings.levels[lead.level];
  if (!lv) { lead.deadlineAt = null; lead.exhausted = true; log(s, "lead.escalation_exhausted", s.contacts.find((c) => c.id === lead.contactId)?.name ?? lead.id, undefined, "No further levels", "system"); return; }
  let owner: Member | null = null;
  if (lv.target === "backup") owner = member(s, s.settings.backupId);
  else if (lv.target === "manager") owner = member(s, s.settings.managerId);
  else if (lv.target === "next") owner = pickNext(s, prev);
  owner ??= pickNext(s, [lead.ownerId ?? ""]) ?? member(s, s.settings.managerId);
  place(s, lead, owner, "escalate", reason);
}
export function tick() {
  const t = now();
  const due = state.leads.some((l) => l.status === "assigned" && l.deadlineAt && l.deadlineAt <= t);
  if (!due) return;
  // F3.8: the new deadline is written in the same synchronous pass, so a lead can't escalate twice.
  mutate((s) => { for (const l of s.leads) if (l.status === "assigned" && l.deadlineAt && l.deadlineAt <= t) escalate(s, l, "Acknowledgement window expired"); });
}
function touch(s: State, contactId: string, label: string) {
  const lead = s.leads.find((l) => l.contactId === contactId && l.ownerId === s.meId);
  if (!lead) return;
  lead.lastActionAt = now();
  if (lead.status === "assigned") {
    lead.status = "acknowledged"; lead.deadlineAt = null; lead.ackedAt ??= now(); lead.ackedBy ??= s.meId;
    lead.history.push({ at: now(), from: s.meId, to: s.meId, kind: "acknowledge", reason: label });
    log(s, "lead.acknowledged", s.contacts.find((c) => c.id === contactId)?.name ?? lead.id, undefined, label);
  }
}
export const acknowledge = (leadId: string) => mutate((s) => {
  const l = s.leads.find((x) => x.id === leadId); if (!l || l.ownerId !== s.meId) return; touch(s, l.contactId, "Acknowledged");
});
export const reassignLead = (leadId: string, toId: string) => mutate((s) => {
  if (!canDo(s, "assignment.manage")) return;
  const l = s.leads.find((x) => x.id === leadId); const m = member(s, toId); if (l && m) place(s, l, m, "reassign", `Manually reassigned by ${nameOf(s, s.meId)}`);
});
export const createManualLead = (name: string, phone: string, email: string, source: string) => mutate((s) => {
  if (!canDo(s, "crm.create")) return;
  let c = s.contacts.find((x) => x.phone === phone && phone);
  if (!c) { c = { id: uid("c"), name, phone, email, companyId: null, tags: [], optedOut: false, custom: {}, createdAt: now(), source }; s.contacts.unshift(c); }
  newLead(s, c.id, source);
});
/** Public form capture: no session needed. */
export const captureLead = (name: string, phone: string, email: string, note: string) => mutate((s) => {
  let c = s.contacts.find((x) => x.phone === phone && phone);
  if (!c) { c = { id: uid("c"), name, phone, email, companyId: null, tags: [], optedOut: false, custom: {}, createdAt: now(), source: "web form" }; s.contacts.unshift(c); }
  if (note) act(s, { contactId: c.id, type: "note", actor: "system", text: `Web form: ${note}` });
  newLead(s, c.id, "web form");
});

/* ---------- availability & team ---------- */
export const setStatus = (memberId: string, status: Availability) => mutate((s) => {
  const m = member(s, memberId); const me = member(s, s.meId); if (!m || !me) return;
  if (m.id !== me.id && me.level === "user") return;
  const before = m.status; m.status = status; log(s, "availability.changed", m.name, before, status);
  if (status === "leave" || status === "offline") {
    for (const l of s.leads) {
      if (l.ownerId !== m.id) continue;
      if (l.status === "assigned" || (l.status === "acknowledged" && s.settings.ackedOnAbsence === "reassign"))
        place(s, l, pickNext(s, [m.id]) ?? member(s, s.settings.managerId), "reassign", `${m.name} set to ${status}`);
    }
  }
});
export const inviteMember = (name: string, email: string, level: Level, roleName: string, perms: Perm[]) => mutate((s) => {
  const me = member(s, s.meId); if (!me || me.level === "user" || level === "owner") return;
  s.members.push({ id: uid("m"), name, email, level, roleName, perms, status: "available", notifyDest: email, calendar: "none", tz: "Asia/Karachi" });
  log(s, "member.invited", name, undefined, `${level} / ${roleName}`);
});
export const updateMember = (id: string, patch: Partial<Pick<Member, "level" | "roleName" | "perms" | "notifyDest">>) => mutate((s) => {
  const me = member(s, s.meId); const m = member(s, id); if (!me || !m || me.level === "user") return;
  if (m.level === "owner" && me.level !== "owner") return; // admins cannot modify the Owner
  if (patch.level === "owner") return;
  const before = `${m.level}/${m.roleName}/${m.perms.join(",")}`; Object.assign(m, patch);
  log(s, "permission.changed", m.name, before, `${m.level}/${m.roleName}/${m.perms.join(",")}`);
});
export const removeMember = (id: string) => mutate((s) => {
  const me = member(s, s.meId); const m = member(s, id); if (!me || !m || me.level === "user" || m.level === "owner" || (m.level === "admin" && me.level !== "owner")) return;
  for (const l of s.leads) if (l.ownerId === m.id && l.status !== "unassigned") place(s, l, pickNext(s, [m.id]) ?? member(s, s.settings.managerId), "reassign", `${m.name} removed`);
  for (const o of s.opps) if (o.ownerId === m.id) o.ownerId = null;
  s.members = s.members.filter((x) => x.id !== id); log(s, "member.removed", m.name);
});
export const setSettings = (patch: Partial<State["settings"]>) => mutate((s) => {
  if (!canDo(s, "assignment.manage")) return;
  log(s, "assignment.rules_changed", "Assignment rules", JSON.stringify(s.settings), JSON.stringify({ ...s.settings, ...patch }));
  Object.assign(s.settings, patch);
});

/* ---------- auth ---------- */
export const loginAs = (memberId: string) => mutate((s) => { s.meId = memberId; });
export const logout = () => mutate((s) => { s.meId = null; });
export function loginWithPassword(email: string, password: string): boolean {
  const m = state.members.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
  if (!m || password !== "demo1234") return false; loginAs(m.id); return true;
}
export const signup = (company: string, name: string, email: string) => { state = blankWorkspace(company, name, email); save(); emit(); };
export const setMemberCalendar = (id: string, v: Member["calendar"]) => mutate((s) => { const m = member(s, id); if (m) m.calendar = v; });

/* ---------- CRM ---------- */
export const addContact = (c: Pick<Contact, "name" | "phone" | "email" | "companyId">) => { let id = ""; mutate((s) => { if (!canDo(s, "crm.create")) return; id = uid("c"); s.contacts.unshift({ ...c, id, tags: [], optedOut: false, custom: {}, createdAt: now(), source: "manual" }); log(s, "contact.created", c.name); }); return id; };
export const updateContact = (id: string, patch: Partial<Contact>) => mutate((s) => {
  if (!canDo(s, "crm.edit")) return; const c = s.contacts.find((x) => x.id === id); if (!c) return;
  for (const k of Object.keys(patch) as (keyof Contact)[]) if (JSON.stringify(c[k]) !== JSON.stringify(patch[k]) && k !== "custom") act(s, { contactId: id, type: "field", text: `${k} changed` });
  Object.assign(c, patch); touch(s, id, "Edited contact");
});
export const setContactCustom = (id: string, fieldId: string, value: string) => mutate((s) => {
  if (!canDo(s, "crm.edit")) return; const c = s.contacts.find((x) => x.id === id); const f = s.fields.find((x) => x.id === fieldId); if (!c || !f) return;
  act(s, { contactId: id, type: "field", text: `${f.name}: ${c.custom[fieldId] || "empty"} → ${value || "empty"}` }); c.custom[fieldId] = value;
});
export const deleteContact = (id: string) => mutate((s) => {
  if (!canDo(s, "crm.delete")) return; const c = s.contacts.find((x) => x.id === id); if (!c) return;
  const oppIds = s.opps.filter((o) => o.contactId === id).map((o) => o.id);
  s.opps = s.opps.filter((o) => o.contactId !== id); s.leads = s.leads.filter((l) => l.contactId !== id); s.messages = s.messages.filter((m) => m.contactId !== id);
  s.payments = s.payments.filter((p) => p.contactId !== id && !oppIds.includes(p.oppId)); s.appointments = s.appointments.filter((a) => a.contactId !== id); s.activity = s.activity.filter((a) => a.contactId !== id);
  s.contacts = s.contacts.filter((x) => x.id !== id); log(s, "contact.deleted", c.name);
});
export const setOptOut = (id: string, v: boolean) => mutate((s) => { const c = s.contacts.find((x) => x.id === id); if (!c || !canDo(s, "crm.edit")) return; c.optedOut = v; act(s, { contactId: id, type: "message", text: v ? "Marked as opted out of messaging" : "Opt-out removed" }); log(s, "contact.optout", c.name, String(!v), String(v)); });
export const addTag = (id: string, tag: string) => mutate((s) => { const c = s.contacts.find((x) => x.id === id); if (c && tag && !c.tags.includes(tag) && canDo(s, "crm.edit")) c.tags.push(tag); });
export const removeTag = (id: string, tag: string) => mutate((s) => { const c = s.contacts.find((x) => x.id === id); if (c && canDo(s, "crm.edit")) c.tags = c.tags.filter((t) => t !== tag); });
export const addNote = (contactId: string, text: string, oppId?: string) => mutate((s) => { if (!text.trim()) return; act(s, { contactId, oppId, type: "note", text }); touch(s, contactId, "Added note"); });
export const addOpp = (contactId: string, pipelineId: string, title: string, value: number) => mutate((s) => {
  if (!canDo(s, "crm.create")) return; const p = s.pipelines.find((x) => x.id === pipelineId); if (!p) return;
  const o = { id: uid("o"), title, contactId, pipelineId, stageId: p.stages[0].id, value, custom: {}, ownerId: s.meId, createdAt: now() };
  s.opps.unshift(o); act(s, { contactId, oppId: o.id, type: "stage", text: `Opportunity "${title}" created in ${p.name}` }); touch(s, contactId, "Created opportunity");
});
export const setOppCustom = (oppId: string, fieldId: string, value: string) => mutate((s) => {
  const o = s.opps.find((x) => x.id === oppId); const f = s.fields.find((x) => x.id === fieldId); if (!o || !f || !canDo(s, "crm.edit")) return;
  act(s, { contactId: o.contactId, oppId, type: "field", text: `${f.name}: ${o.custom[fieldId] || "empty"} → ${value || "empty"}` }); o.custom[fieldId] = value;
});
export const setOppValue = (oppId: string, value: number) => mutate((s) => { const o = s.opps.find((x) => x.id === oppId); if (!o || !canDo(s, "crm.edit") || !canDo(s, "value.view")) return; act(s, { contactId: o.contactId, oppId, type: "field", text: `Value: ${o.value} → ${value}` }); o.value = value; });
export const setOppOwner = (oppId: string, ownerId: string) => mutate((s) => { const o = s.opps.find((x) => x.id === oppId); if (!o || !canDo(s, "assignment.manage")) return; act(s, { contactId: o.contactId, oppId, type: "assignment", text: `Owner → ${nameOf(s, ownerId)}` }); o.ownerId = ownerId; });
export function moveOpp(oppId: string, stageId: string): { ok: boolean; error?: string } {
  let res: { ok: boolean; error?: string } = { ok: true };
  mutate((s) => {
    if (!canDo(s, "crm.edit")) { res = { ok: false, error: "You don't have permission to edit records." }; return; }
    const o = s.opps.find((x) => x.id === oppId); const p = s.pipelines.find((x) => x.id === o?.pipelineId); const st = p?.stages.find((x) => x.id === stageId);
    if (!o || !p || !st) { res = { ok: false, error: "Stage not found." }; return; }
    const missing = st.required.filter((fid) => !(o.custom[fid] ?? "").toString().trim());
    if (missing.length) { res = { ok: false, error: `Fill in ${missing.map((m) => s.fields.find((f) => f.id === m)?.name ?? m).join(", ")} before moving to "${st.name}".` }; return; }
    const from = p.stages.find((x) => x.id === o.stageId)?.name; o.stageId = stageId;
    act(s, { contactId: o.contactId, oppId, type: "stage", text: `Moved ${from} → ${st.name}` }); touch(s, o.contactId, "Changed stage");
  });
  return res;
}

/* ---------- pipeline & fields config ---------- */
const needCfg = (s: State) => canDo(s, "config.manage");
export const addPipeline = (name: string) => mutate((s) => { if (!needCfg(s)) return; s.pipelines.push({ id: uid("pl"), name, stages: [{ id: uid("st"), name: "New", kind: "open", required: [] }, { id: uid("st"), name: "Won", kind: "won", required: [] }, { id: uid("st"), name: "Lost", kind: "lost", required: [] }] }); log(s, "pipeline.created", name); });
export const addStage = (pid: string, name: string) => mutate((s) => { if (!needCfg(s)) return; const p = s.pipelines.find((x) => x.id === pid); if (!p) return; const idx = p.stages.findIndex((x) => x.kind !== "open"); p.stages.splice(idx < 0 ? p.stages.length : idx, 0, { id: uid("st"), name, kind: "open", required: [] }); log(s, "pipeline.stage_added", `${p.name} / ${name}`); });
export const renameStage = (pid: string, sid: string, name: string) => mutate((s) => { if (!needCfg(s)) return; const st = s.pipelines.find((x) => x.id === pid)?.stages.find((x) => x.id === sid); if (!st || !name.trim()) return; log(s, "pipeline.stage_renamed", st.name, st.name, name); st.name = name; });
export const moveStage = (pid: string, sid: string, dir: -1 | 1) => mutate((s) => { if (!needCfg(s)) return; const p = s.pipelines.find((x) => x.id === pid); if (!p) return; const i = p.stages.findIndex((x) => x.id === sid); const j = i + dir; if (i < 0 || j < 0 || j >= p.stages.length) return; [p.stages[i], p.stages[j]] = [p.stages[j], p.stages[i]]; log(s, "pipeline.stage_reordered", p.stages[j].name); });
export const setStageRequired = (pid: string, sid: string, fieldIds: string[]) => mutate((s) => { if (!needCfg(s)) return; const st = s.pipelines.find((x) => x.id === pid)?.stages.find((x) => x.id === sid); if (!st) return; log(s, "pipeline.required_fields_changed", st.name, st.required.join(","), fieldIds.join(",")); st.required = fieldIds; });
/** Deleting a stage that holds opportunities requires a destination stage, so nothing is orphaned. */
export function deleteStage(pid: string, sid: string, moveTo?: string): { ok: boolean; error?: string } {
  let res: { ok: boolean; error?: string } = { ok: true };
  mutate((s) => {
    if (!needCfg(s)) { res = { ok: false, error: "No permission." }; return; }
    const p = s.pipelines.find((x) => x.id === pid); const st = p?.stages.find((x) => x.id === sid); if (!p || !st) return;
    if (p.stages.length <= 2) { res = { ok: false, error: "A pipeline needs at least two stages." }; return; }
    const held = s.opps.filter((o) => o.stageId === sid);
    if (held.length && (!moveTo || moveTo === sid || !p.stages.some((x) => x.id === moveTo))) { res = { ok: false, error: `${held.length} opportunities are in this stage. Choose a stage to move them to.` }; return; }
    held.forEach((o) => { o.stageId = moveTo!; act(s, { contactId: o.contactId, oppId: o.id, type: "stage", text: `Stage "${st.name}" deleted; moved to ${p.stages.find((x) => x.id === moveTo)?.name}` }); });
    p.stages = p.stages.filter((x) => x.id !== sid); log(s, "pipeline.stage_deleted", `${p.name} / ${st.name}`, undefined, held.length ? `${held.length} moved` : undefined);
  });
  return res;
}
export const addField = (name: string, type: FieldType, entity: "contact" | "opportunity", pipelineId: string | null, options?: string[]) => mutate((s) => { if (!needCfg(s) || !name.trim()) return; const f: CustomField = { id: uid("f"), name, type, entity, pipelineId: entity === "contact" ? null : pipelineId, options }; s.fields.push(f); log(s, "field.created", name, undefined, `${type} / ${entity}`); });
export const deleteField = (id: string) => mutate((s) => { if (!needCfg(s)) return; const f = s.fields.find((x) => x.id === id); if (!f) return; s.fields = s.fields.filter((x) => x.id !== id); s.pipelines.forEach((p) => p.stages.forEach((st) => { st.required = st.required.filter((r) => r !== id); })); s.opps.forEach((o) => delete o.custom[id]); s.contacts.forEach((c) => delete c.custom[id]); log(s, "field.deleted", f.name); });

/* ---------- lists ---------- */
export const saveList = (name: string, criteria: Criterion[]) => mutate((s) => { s.lists.push({ id: uid("sl"), name, criteria }); });
export const deleteList = (id: string) => mutate((s) => { s.lists = s.lists.filter((l) => l.id !== id); });
export function matchesCriteria(s: State, c: Contact, criteria: Criterion[]) {
  return criteria.every((k) => {
    const opps = s.opps.filter((o) => o.contactId === c.id); const lead = s.leads.find((l) => l.contactId === c.id);
    switch (k.field) {
      case "tag": return c.tags.includes(k.value);
      case "stage": return opps.some((o) => o.stageId === k.value);
      case "owner": return opps.some((o) => o.ownerId === k.value) || lead?.ownerId === k.value;
      case "source": return c.source === k.value;
      case "createdDays": return c.createdAt >= now() - Number(k.value || 0) * 86400_000;
    }
  });
}

/* ---------- conversations (I1) ---------- */
function deliver(id: string) {
  setTimeout(() => mutate((s) => { const m = s.messages.find((x) => x.id === id); if (m && m.status === "queued") { m.status = "sent"; sync(s, "messaging", "out", "ok", m.ref, "Status callback: sent"); } }), 700);
  setTimeout(() => mutate((s) => { const m = s.messages.find((x) => x.id === id); if (m && m.status === "sent") { m.status = "delivered"; sync(s, "messaging", "in", "ok", m.ref, "Status callback: delivered"); } }), 1800);
}
export function sendMessage(contactId: string, body: string): { ok: boolean; error?: string } {
  let res: { ok: boolean; error?: string } = { ok: true };
  mutate((s) => {
    const c = s.contacts.find((x) => x.id === contactId); if (!c || !body.trim()) { res = { ok: false }; return; }
    if (c.optedOut) { res = { ok: false, error: "This contact opted out of messaging. Remove the opt-out only if they ask to be contacted again." }; return; }
    const m = s.integrations.messaging; const id = uid("m"); const ref = "SM" + id.slice(2);
    const msg = { id, contactId, direction: "out" as const, body, at: now(), status: "queued" as const, ref, by: s.meId ?? undefined, error: undefined as string | undefined };
    s.messages.push(msg); act(s, { contactId, type: "message", text: `Sent: ${body.slice(0, 60)}` }); touch(s, contactId, "Sent message");
    if (m.status !== "connected") { msg.status = "failed" as never; msg.error = "Messaging isn't connected. Ask an admin to connect it on the Integrations page."; sync(s, "messaging", "out", "failed", ref, msg.error); }
    else if (m.failNext) { msg.status = "failed" as never; msg.error = "Provider rejected the send (simulated error 63016: outside the 24h session window)."; m.failNext = false; sync(s, "messaging", "out", "failed", ref, msg.error); }
    else { sync(s, "messaging", "out", "ok", ref, "Queued with provider"); deliver(id); }
  });
  return res;
}
export const retryMessage = (id: string) => { const m = state.messages.find((x) => x.id === id); if (!m) return; mutate((s) => { s.messages = s.messages.filter((x) => x.id !== id); }); sendMessage(m.contactId, m.body); };
export function simulateIncoming(phone: string, body: string, providerId?: string) {
  mutate((s) => {
    const ref = providerId ?? "SM" + uid("in").slice(3);
    if (s.messages.some((m) => m.ref === ref)) { sync(s, "messaging", "in", "duplicate", ref, "Duplicate webhook ignored"); return; }
    let c = s.contacts.find((x) => x.phone === phone); let created = false;
    if (!c) { c = { id: uid("c"), name: phone, phone, email: "", companyId: null, tags: [], optedOut: false, custom: {}, createdAt: now(), source: "whatsapp" }; s.contacts.unshift(c); created = true; }
    s.messages.push({ id: uid("m"), contactId: c.id, direction: "in", body, at: now(), status: "received", ref });
    sync(s, "messaging", "in", "ok", ref, created ? "Webhook verified; new contact + lead created" : "Webhook verified; attached to existing contact");
    if (created) newLead(s, c.id, "whatsapp");
    if (/^stop$/i.test(body.trim())) { c.optedOut = true; act(s, { contactId: c.id, type: "message", actor: "system", text: "Opt-out keyword received" }); }
  });
}
export const simulateForgedWebhook = () => mutate((s) => sync(s, "messaging", "in", "rejected", "forged-" + uid("x").slice(2), "Signature check failed; request rejected"));
export const setFailNext = (v: boolean) => mutate((s) => { s.integrations.messaging.failNext = v; });

/* ---------- payments (I2) ---------- */
export const requestPayment = (oppId: string, amount: number, currency: string) => mutate((s) => {
  const o = s.opps.find((x) => x.id === oppId); if (!o || !(amount > 0)) return;
  if (s.integrations.payments.status !== "connected") return;
  const ref = "cs_test_" + uid("").slice(1);
  s.payments.unshift({ id: uid("p"), oppId, contactId: o.contactId, amount, currency, at: now(), status: "pending", requestedBy: s.meId ?? "system", ref, link: `https://checkout.stripe.com/c/pay/${ref}` });
  sync(s, "payments", "out", "ok", ref, "Checkout session created"); act(s, { contactId: o.contactId, oppId, type: "payment", text: `Payment request ${currency} ${amount} created` }); touch(s, o.contactId, "Requested payment");
});
export const paymentEvent = (id: string, ev: "paid" | "failed" | "expired" | "refunded") => mutate((s) => {
  const p = s.payments.find((x) => x.id === id); if (!p) return;
  if (p.status === ev) { sync(s, "payments", "in", "duplicate", p.ref, `Duplicate ${ev} event ignored`); return; }
  p.status = ev; sync(s, "payments", "in", "ok", p.ref, `Webhook verified: ${ev}`); act(s, { contactId: p.contactId, oppId: p.oppId, type: "payment", actor: "system", text: `Payment ${ev} (${p.ref})` });
});

/* ---------- calendar (I3) ---------- */
export const conflicts = (s: State, memberId: string, start: number, end: number, exclude?: string) =>
  s.appointments.filter((a) => a.memberId === memberId && a.status === "confirmed" && a.id !== exclude && a.start < end && start < a.end);
export function bookAppointment(a: Omit<Appointment, "id" | "status">, force = false): { ok: boolean; error?: string } {
  let res: { ok: boolean; error?: string } = { ok: true };
  mutate((s) => {
    const m = member(s, a.memberId);
    if (!m || m.calendar !== "connected") { res = { ok: false, error: `${m?.name ?? "This employee"} has no connected Google Calendar, so they can't be booked.` }; return; }
    if (!force && conflicts(s, a.memberId, a.start, a.end).length) { res = { ok: false, error: "That slot overlaps another busy time." }; return; }
    const ap: Appointment = { ...a, id: uid("a"), status: "confirmed" }; s.appointments.push(ap);
    sync(s, "calendar", "out", "ok", ap.id, "Event created"); act(s, { contactId: a.contactId, oppId: a.oppId ?? undefined, type: "appointment", text: `Booked "${a.title}" with ${m.name}` }); touch(s, a.contactId, "Booked appointment");
  });
  return res;
}
export const cancelAppointment = (id: string) => mutate((s) => { const a = s.appointments.find((x) => x.id === id); if (!a) return; a.status = "cancelled"; sync(s, "calendar", "out", "ok", id, "Event cancelled"); act(s, { contactId: a.contactId, type: "appointment", text: `Cancelled "${a.title}"` }); });
export const rescheduleAppointment = (id: string, start: number, end: number): { ok: boolean; error?: string } => {
  let res: { ok: boolean; error?: string } = { ok: true };
  mutate((s) => { const a = s.appointments.find((x) => x.id === id); if (!a) return; if (conflicts(s, a.memberId, start, end, id).length) { res = { ok: false, error: "That slot overlaps another busy time." }; return; } a.start = start; a.end = end; sync(s, "calendar", "out", "ok", id, "Event updated"); act(s, { contactId: a.contactId, type: "appointment", text: `Rescheduled "${a.title}"` }); });
  return res;
};

/* ---------- integrations page ---------- */
const providers: Record<IntegrationKey, string[]> = { messaging: ["Twilio WhatsApp Sandbox", "Twilio SMS"], payments: ["Stripe (test mode)"], calendar: ["Google Calendar (OAuth 2.0)"], notifications: ["Slack", "Telegram bot", "Email (Resend)"] };
export const providerOptions = (k: IntegrationKey) => providers[k];
export const connectIntegration = (k: IntegrationKey, provider?: string) => mutate((s) => { if (!canDo(s, "integrations.manage")) return; const i = s.integrations[k]; i.status = "connected"; i.lastOk = now(); if (provider) i.provider = provider; i.errors = []; if (k === "calendar") s.members.forEach((m) => { if (m.calendar === "needs_reconnect") m.calendar = "connected"; }); log(s, "integration.connected", k, undefined, i.provider); });
export const disconnectIntegration = (k: IntegrationKey) => mutate((s) => { if (!canDo(s, "integrations.manage")) return; s.integrations[k].status = "not_connected"; log(s, "integration.disconnected", k); });

/* ---------- misc ---------- */
export const markNotificationsRead = () => mutate((s) => { s.notifications.forEach((n) => { if (n.userId === s.meId) n.read = true; }); });
export const toggleTile = (id: string) => mutate((s) => { if (!s.meId) return; const h = (s.hiddenTiles[s.meId] ??= []); const i = h.indexOf(id); if (i >= 0) h.splice(i, 1); else h.push(id); });

/* ---------- derived ---------- */
export function recoveryItems(s: State) {
  const t = now(); const out: { lead: Lead; reasons: string[] }[] = [];
  for (const l of s.leads) {
    const r: string[] = []; const owner = member(s, l.ownerId);
    if (l.status === "unassigned") r.push("No eligible employee available");
    if (l.status === "assigned" && l.deadlineAt && l.deadlineAt < t) r.push("Unacknowledged beyond window");
    if (l.exhausted) r.push("All escalation levels used");
    if (l.escalations >= 2) r.push(`Escalated ${l.escalations} times`);
    if (l.status === "acknowledged" && t - l.lastActionAt > s.settings.idleSeconds * 1000) r.push(`No action for ${Math.round((t - l.lastActionAt) / 60000)} min`);
    if (owner && (owner.status === "leave" || owner.status === "offline") && l.status !== "unassigned") r.push(`Owner is ${owner.status === "leave" ? "on leave" : "offline"}`);
    if (r.length) out.push({ lead: l, reasons: r });
  }
  return out;
}
export const todayStart = () => startOfDay();
export { defaultSettings };
export const setMyNotifyDest = (dest: string) => mutate((s) => { const m = member(s, s.meId); if (m) { m.notifyDest = dest; log(s, "notification.destination_changed", m.name); } });
export const simulateDuplicateWebhook = (phone: string) => { simulateIncoming(phone, "Duplicate delivery test", "SMDUP0001"); simulateIncoming(phone, "Duplicate delivery test", "SMDUP0001"); };
