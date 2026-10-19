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
import type { ServerWorkspace } from "./api";
import type {
  Activity, Appointment, Availability, Contact, Criterion, CustomField, FieldType, IntegrationKey, Lead,
  Level, Member, Opportunity, Perm, State,
} from "./types";

/*
 * Two modes:
 *  - demo: the sample workspace, stored only in this browser (DEMO_KEY).
 *  - live: signed in with Supabase. Workspace, team, roles and settings come from apps/api and every
 *    change to them goes through the API (server-enforced permissions + audit). Modules not yet moved
 *    to the server (CRM, leads, ...) are kept per workspace in this browser (liveKey) until migrated.
 */
const DEMO_KEY = "nascon26.state.v2";
const liveKey = (wsId: string) => `nascon26.live.v1.${wsId}`;
let storageKey = DEMO_KEY;
const SERVER = emptyState();
let state: State = SERVER;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const save = () => { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* storage full or blocked */ } };
function mutate(fn: (s: State) => void) { const n = structuredClone(state); fn(n); state = n; save(); emit(); }

export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useStore = () => useSyncExternalStore(subscribe, () => state, () => SERVER);
export const getState = () => state;
const isLive = () => state.mode === "live";

/** UI feedback hooks; Engine wires these to toasts (kept out of here so the store runs in tests). */
let feedback: { error: (msg: string) => void; ok: (msg: string) => void } = { error: (m) => console.error(m), ok: () => {} };
export const setFeedback = (f: typeof feedback) => { feedback = f; };

let listening = false;
function listenStorage() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("storage", (e) => {
    if (e.key === storageKey && e.newValue) { state = { ...JSON.parse(e.newValue), hydrated: true }; emit(); }
  });
}

/** Demo mode boot (no Supabase session). */
export function hydrate() {
  storageKey = DEMO_KEY;
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    state = raw ? { ...JSON.parse(raw), mode: "demo", hydrated: true } : makeSeed();
  } catch { state = makeSeed(); }
  save(); emit(); listenStorage();
}
export const resetDemo = () => { state = makeSeed(); save(); emit(); };

/* ---------- live mode (Supabase session + apps/api) ---------- */
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Replace workspace/team/roles/settings with the server's copy. */
function applyServer(p: ServerWorkspace) {
  const n = structuredClone(state);
  n.mode = "live"; n.hydrated = true;
  n.workspace = p.workspace; n.roles = p.roles; n.meId = p.meId; n.settings = p.settings;
  n.members = p.members.map((m) => { const { hiddenTiles, ...rest } = m; void hiddenTiles; return { ...rest, tz: state.members.find((x) => x.id === m.id)?.tz ?? localTz() }; });
  const mine = p.members.find((m) => m.id === p.meId);
  if (mine) n.hiddenTiles[p.meId] = mine.hiddenTiles;
  state = n; save(); emit();
}

function bootLive(p: ServerWorkspace) {
  storageKey = liveKey(p.workspace.id);
  let base: State;
  try {
    const raw = localStorage.getItem(storageKey);
    base = raw ? JSON.parse(raw) : blankWorkspace(p.workspace.name, "", "");
  } catch { base = blankWorkspace(p.workspace.name, "", ""); }
  state = { ...base, mode: "live", hydrated: true };
  applyServer(p);
  listenStorage();
  void syncCrm(); void syncLeads(); void syncAppointments(); startLiveUpdates();
}

/** If a Supabase session exists, load the workspace from the API. Returns false to fall back to demo mode. */
export async function bootFromSession(): Promise<boolean> {
  const { supabase } = await import("./supabase");
  const { data } = await supabase.auth.getSession();
  if (!data.session) return false;
  const { api, ApiError } = await import("./api");
  try {
    bootLive(await api("/me"));
    return true;
  } catch (e) {
    // 401/403: session no longer valid or not in a workspace -> sign out. Network errors keep the session.
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) await supabase.auth.signOut();
    feedback.error(e instanceof Error ? e.message : "Could not load your workspace.");
    return false;
  }
}

/** Run an API call that returns the workspace payload, apply it, and report errors. */
async function remote<T extends ServerWorkspace>(path: string, method: string, body?: unknown, okMsg?: string): Promise<T | null> {
  const { api } = await import("./api");
  try {
    const p = await api<T>(path, { method, body });
    applyServer(p);
    if (okMsg) feedback.ok(okMsg);
    return p;
  } catch (e) {
    feedback.error(e instanceof Error ? e.message : "Something went wrong.");
    // resync so optimistic local changes don't linger
    try { applyServer(await api("/me")); } catch { /* offline: keep local copy */ }
    return null;
  }
}

/* ---------- sync status (Q10): first load, saves in flight, last error — not persisted ---------- */
export type SyncStatus = { loaded: boolean; saving: number; error: string | null };
let syncStatus: SyncStatus = { loaded: false, saving: 0, error: null };
const statusListeners = new Set<() => void>();
const setSync = (p: Partial<SyncStatus>) => { syncStatus = { ...syncStatus, ...p }; statusListeners.forEach((l) => l()); };
export const useSyncStatus = () => useSyncExternalStore((l) => { statusListeners.add(l); return () => { statusListeners.delete(l); }; }, () => syncStatus, () => syncStatus);

/* ---------- live CRM (M2): companies, contacts, opportunities, pipelines, fields, activity ---------- */
type CrmSnapshot = Pick<State, "companies" | "contacts" | "opps" | "pipelines" | "fields" | "activity" | "lists"> & { messages?: State["messages"]; messagingStatus?: State["integrations"]["messaging"]["status"] };
let crmWriting = false;
/** New record ids: UUIDs in live mode so the optimistic local copy and the server row share one id. */
const rid = (prefix: string) => (isLive() && typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : uid(prefix));

function applyCrm(d: CrmSnapshot) {
  const n = structuredClone(state);
  n.companies = d.companies; n.contacts = d.contacts; n.opps = d.opps; n.pipelines = d.pipelines; n.fields = d.fields; n.lists = d.lists;
  if (d.messages) n.messages = d.messages;
  if (d.messagingStatus) { n.integrations.messaging.status = d.messagingStatus; n.integrations.messaging.provider = "Twilio WhatsApp Sandbox"; }
  // server history + local-only entries from modules not migrated yet (messages, payments, leads...)
  const local = n.activity.filter((a) => !a.id.startsWith("srv_") && !a.id.startsWith("tmp_"));
  n.activity = [...d.activity, ...local].sort((a, b) => b.at - a.at).slice(0, 2000);
  state = n; save(); emit();
}

export async function syncCrm() {
  if (!isLive()) return;
  const { api, ApiError } = await import("./api");
  try { applyCrm(await api<CrmSnapshot>("/crm")); setSync({ loaded: true, error: null }); }
  catch (e) {
    if (e instanceof ApiError && e.status === 403) { applyCrm({ companies: [], contacts: [], opps: [], pipelines: state.pipelines, fields: state.fields, activity: [], lists: [] }); setSync({ loaded: true, error: null }); }
    else setSync({ loaded: true, error: e instanceof Error ? e.message : "Could not load CRM records." });
  }
}
let syncTimer: ReturnType<typeof setTimeout> | undefined;
const scheduleSync = () => { clearTimeout(syncTimer); syncTimer = setTimeout(() => { void syncCrm(); void syncLeads(); }, 400); };

/* ---------- live leads (M4): the engine runs in Postgres; the browser only shows it ---------- */
export async function syncLeads() {
  if (!isLive()) return;
  const { api } = await import("./api");
  try {
    const { leads } = await api<{ leads: Lead[] }>("/leads");
    const n = structuredClone(state);
    // surface "assigned to you" as an in-app notification (Engine toasts it) when ownership moves to me
    for (const l of leads) {
      const before = n.leads.find((x) => x.id === l.id);
      if (l.ownerId && l.ownerId === n.meId && before?.ownerId !== n.meId && l.status === "assigned") {
        const c = n.contacts.find((x) => x.id === l.contactId);
        n.notifications.unshift({ id: uid("nt"), at: now(), userId: n.meId!, text: `${l.escalations ? "Escalated lead" : "New lead"}: ${c?.name ?? "contact"} (${l.source})`, leadId: l.id, read: false });
      }
    }
    n.leads = leads; state = n; save(); emit();
  } catch { /* the header sync indicator covers CRM errors; leads retry on the next poll */ }
}
let leadTimer: ReturnType<typeof setTimeout> | undefined;
const scheduleLeadSync = () => { clearTimeout(leadTimer); leadTimer = setTimeout(() => void syncLeads(), 300); };
let liveStarted = false;
/** Q11: Supabase Realtime pushes lead changes (RLS limits it to this workspace); a 15 s poll backs it up. */
async function startLiveUpdates() {
  if (liveStarted || typeof window === "undefined") return;
  liveStarted = true;
  const { supabase } = await import("./supabase");
  supabase.channel("leads-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => scheduleLeadSync())
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => scheduleSync())
    .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => scheduleApptSync())
    .subscribe();
  setInterval(() => { if (isLive()) { void syncLeads(); void syncAppointments(); } }, 15_000);
}
async function leadRemote(path: string, body?: unknown, okMsg?: string) {
  const { api } = await import("./api");
  try { await api(path, { method: "POST", body }); if (okMsg) feedback.ok(okMsg); return true; }
  catch (e) { feedback.error(e instanceof Error ? e.message : "Couldn't update the lead."); return false; }
  finally { void syncLeads(); }
}

/** Optimistic local change (with placeholder activity), then the server write; on failure resync to undo. */
function crmLocal(fn: (s: State) => void) { crmWriting = isLive(); try { mutate(fn); } finally { crmWriting = false; } }
async function crmRemote(path: string, method: string, body?: unknown, okMsg?: string) {
  const { api } = await import("./api");
  setSync({ saving: syncStatus.saving + 1 });
  try {
    const r = await api<{ contact?: Contact; opportunity?: Opportunity; company?: State["companies"][number] }>(path, { method, body });
    // apply the saved row right away (new opportunity version etc.); activity arrives with the sync
    if (r.opportunity || r.contact || r.company) mutate((s) => {
      if (r.opportunity) s.opps = s.opps.map((o) => (o.id === r.opportunity!.id ? r.opportunity! : o));
      if (r.contact) s.contacts = s.contacts.map((c) => (c.id === r.contact!.id ? r.contact! : c));
      if (r.company) s.companies = s.companies.map((c) => (c.id === r.company!.id ? r.company! : c));
    });
    if (okMsg) feedback.ok(okMsg);
    return true;
  } catch (e) {
    feedback.error(e instanceof Error ? e.message : "Couldn't save. Your change was undone.");
    return false;
  } finally { setSync({ saving: Math.max(0, syncStatus.saving - 1) }); scheduleSync(); }
}
const oppVersion = (id: string) => state.opps.find((o) => o.id === id)?.version ?? 1;

export async function signIn(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await import("./supabase");
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { ok: false, error: /invalid/i.test(error.message) ? "That email and password don't match." : error.message };
  return (await bootFromSession()) ? { ok: true } : { ok: false, error: "Signed in, but your workspace could not be loaded." };
}

export async function signUp(company: string, name: string, email: string, password: string): Promise<{ ok: boolean; error?: string; fields?: Record<string, string> }> {
  const { api, ApiError } = await import("./api");
  try {
    await api("/auth/signup", { method: "POST", body: { company, name, email, password } });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sign up failed.", fields: e instanceof ApiError ? e.fields : undefined };
  }
  return signIn(email, password);
}

/* ---------- helpers ---------- */
const now = () => Date.now();
const member = (s: State, id: string | null | undefined) => s.members.find((m) => m.id === id) ?? null;
export const nameOf = (s: State, id: string | null | undefined) => (id === "system" ? "System" : member(s, id)?.name ?? "—");
const canDo = (s: State, p: Perm) => { const me = member(s, s.meId); return !!me && (me.level === "owner" || me.perms.includes(p)); };
const log = (s: State, type: string, target: string, before?: string, after?: string, actor?: string) =>
  s.audit.unshift({ id: uid("au"), at: now(), actor: actor ?? s.meId ?? "system", type, target, before, after });
// During a live CRM write the server records the real activity; the local copy is a placeholder (tmp_) replaced on sync.
const act = (s: State, a: Omit<Activity, "id" | "at" | "actor"> & { actor?: string }) =>
  s.activity.unshift({ id: crmWriting ? uid("tmp") : uid("ac"), at: now(), actor: a.actor ?? s.meId ?? "system", ...a });
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
  if (isLive()) return;
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
export const acknowledge = (leadId: string) => { if (isLive()) { void leadRemote(`/leads/${leadId}/acknowledge`, undefined, "Lead acknowledged"); return; } acknowledgeLocal(leadId); };
const acknowledgeLocal = (leadId: string) => mutate((s) => {
  const l = s.leads.find((x) => x.id === leadId); if (!l || l.ownerId !== s.meId) return; touch(s, l.contactId, "Acknowledged");
});
export const reassignLead = (leadId: string, toId: string) => { if (isLive()) { void leadRemote(`/leads/${leadId}/reassign`, { to: toId }, "Lead reassigned"); return; } reassignLocal(leadId, toId); };
const reassignLocal = (leadId: string, toId: string) => mutate((s) => {
  if (!canDo(s, "assignment.manage")) return;
  const l = s.leads.find((x) => x.id === leadId); const m = member(s, toId); if (l && m) place(s, l, m, "reassign", `Manually reassigned by ${nameOf(s, s.meId)}`);
});
/** Find a contact by phone, or create it (also on the server in live mode, so the lead points at a real record). */
function contactForLead(name: string, phone: string, email: string, source: string): { id: string; saved: Promise<boolean> } {
  const existing = state.contacts.find((x) => x.phone === phone && phone);
  if (existing) return { id: existing.id, saved: Promise.resolve(true) };
  const id = rid("c");
  crmLocal((s) => { s.contacts.unshift({ id, name, phone, email, companyId: null, tags: [], optedOut: false, custom: {}, createdAt: now(), source, ownerId: null }); });
  const saved = isLive() ? crmRemote("/contacts", "POST", { id, name, phone, email, source }) : Promise.resolve(true);
  return { id, saved };
}
export const createManualLead = (name: string, phone: string, email: string, source: string) => {
  if (isLive()) { void leadRemote("/leads", { name, phone, email }, "Lead created and assigned").then(() => scheduleSync()); return; }
  if (!canDo(state, "crm.create")) return;
  const { id: cid } = contactForLead(name, phone, email, source);
  mutate((s) => { newLead(s, cid, source); });
};
export const captureLead = (name: string, phone: string, email: string, note: string) => {
  if (isLive()) { void leadRemote(`/public/capture/${state.workspace.id}`, { name, phone, email, note }).then(() => scheduleSync()); return; }
  const { id: cid, saved } = contactForLead(name, phone, email, "web form");
  mutate((s) => {
    if (note) act(s, { contactId: cid, type: "note", actor: "system", text: `Web form: ${note}` });
    newLead(s, cid, "web form");
  });
  if (note && isLive()) void saved.then((ok) => ok && crmRemote(`/contacts/${cid}/notes`, "POST", { text: `Web form: ${note}` }));
};

/* ---------- availability & team ---------- */
/** Moves this member's local leads to someone else (local copy of what set_member_status does in SQL). */
function reassignLocalLeads(s: State, m: Member, why: string) {
  for (const l of s.leads) {
    if (l.ownerId !== m.id) continue;
    if (l.status === "assigned" || (l.status === "acknowledged" && s.settings.ackedOnAbsence === "reassign"))
      place(s, l, pickNext(s, [m.id]) ?? member(s, s.settings.managerId), "reassign", why);
  }
}
const canManageTeam = (me: Member | null) => !!me && (me.level !== "user" || me.perms.includes("users.manage"));
const applyRole = (s: State, m: Member) => {
  const r = s.roles.find((x) => x.id === m.roleId);
  m.roleName = m.level === "owner" ? "Owner" : r?.name ?? "No role";
  m.perms = m.level === "owner" ? m.perms : r?.perms ?? [];
};

export const setStatus = (memberId: string, status: Availability) => {
  mutate((s) => {
    const m = member(s, memberId); const me = member(s, s.meId); if (!m || !me) return;
    if (m.id !== me.id && me.level === "user" && !me.perms.includes("assignment.manage")) return;
    const before = m.status; m.status = status;
    if (!isLive()) log(s, "availability.changed", m.name, before, status);
    if (!isLive() && (status === "leave" || status === "offline")) reassignLocalLeads(s, m, `${m.name} set to ${status}`);
  });
  if (isLive()) void remote(`/members/${memberId}/status`, "POST", { status }).then(() => syncLeads());
};

/** Returns the one-time temporary password in live mode (shown once to the inviter). */
export async function inviteMember(name: string, email: string, level: Exclude<Level, "owner">, roleId: string | null): Promise<{ tempPassword?: string } | null> {
  if (isLive()) {
    const p = await remote<ServerWorkspace & { invited: { tempPassword: string } }>("/members", "POST", { name, email, level, roleId }, `${name} added`);
    return p ? { tempPassword: p.invited.tempPassword } : null;
  }
  mutate((s) => {
    const me = member(s, s.meId); if (!canManageTeam(me) || (level === "admin" && me?.level !== "owner")) return;
    const m: Member = { id: uid("m"), name, email, level, roleId, roleName: "", perms: [], status: "available", notifyDest: email, calendar: "none", tz: localTz() };
    applyRole(s, m); s.members.push(m);
    log(s, "member.invited", name, undefined, `${level} / ${m.roleName}`);
  });
  return {};
}

export const updateMember = (id: string, patch: { level?: Exclude<Level, "owner">; roleId?: string | null }) => {
  if (isLive()) { void remote(`/members/${id}`, "PATCH", patch, "Team member updated"); return; }
  mutate((s) => {
    const me = member(s, s.meId); const m = member(s, id); if (!me || !m || !canManageTeam(me)) return;
    if (m.level === "owner" || (m.level === "admin" && me.level !== "owner")) return; // F1.2
    if (patch.level === "admin" && me.level !== "owner") return;
    const before = `${m.level}/${m.roleName}`; Object.assign(m, patch); applyRole(s, m);
    log(s, "permission.changed", m.name, before, `${m.level}/${m.roleName}`);
  });
};

export const removeMember = (id: string) => {
  if (isLive()) {
    void remote(`/members/${id}`, "DELETE", undefined, "Team member removed").then(() => syncLeads());
    return;
  }
  mutate((s) => {
    const me = member(s, s.meId); const m = member(s, id); if (!me || !m || !canManageTeam(me) || m.level === "owner" || (m.level === "admin" && me.level !== "owner")) return;
    for (const l of s.leads) if (l.ownerId === m.id && l.status !== "unassigned") place(s, l, pickNext(s, [m.id]) ?? member(s, s.settings.managerId), "reassign", `${m.name} removed`);
    for (const o of s.opps) if (o.ownerId === m.id) o.ownerId = null;
    s.members = s.members.filter((x) => x.id !== id); log(s, "member.removed", m.name);
  });
};

/** Create (id null) or update a role: a named set of permissions (F1.3). */
export const saveRole = (id: string | null, name: string, perms: Perm[]) => {
  if (isLive()) { void remote(id ? `/roles/${id}` : "/roles", id ? "PATCH" : "POST", { name, perms }, id ? undefined : `Role "${name}" created`); return; }
  mutate((s) => {
    if (!canManageTeam(member(s, s.meId))) return;
    const r = id ? s.roles.find((x) => x.id === id) : null;
    if (r) { log(s, "role.changed", r.name, `${r.name}: ${r.perms.join(", ")}`, `${name}: ${perms.join(", ")}`); r.name = name; r.perms = perms; }
    else { s.roles.push({ id: uid("r"), name, perms }); log(s, "role.created", name, undefined, perms.join(", ")); }
    s.members.forEach((m) => applyRole(s, m));
  });
};

export const deleteRole = (id: string) => {
  if (isLive()) { void remote(`/roles/${id}`, "DELETE", undefined, "Role deleted"); return; }
  mutate((s) => {
    if (!canManageTeam(member(s, s.meId))) return;
    const r = s.roles.find((x) => x.id === id); if (!r) return;
    s.roles = s.roles.filter((x) => x.id !== id);
    s.members.forEach((m) => { if (m.roleId === id) m.roleId = null; applyRole(s, m); });
    log(s, "role.deleted", r.name);
  });
};

let settingsTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSettings: Partial<State["settings"]> = {};
export const setSettings = (patch: Partial<State["settings"]>) => {
  mutate((s) => {
    if (!canDo(s, "assignment.manage")) return;
    if (!isLive()) log(s, "assignment.rules_changed", "Assignment rules", JSON.stringify(s.settings), JSON.stringify({ ...s.settings, ...patch }));
    Object.assign(s.settings, patch);
  });
  if (!isLive()) return;
  // inputs fire on every keystroke: batch and save after a short pause
  pendingSettings = { ...pendingSettings, ...patch };
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => { const p = pendingSettings; pendingSettings = {}; void remote("/workspace", "PATCH", { settings: p }, "Assignment rules saved"); }, 700);
};

/* ---------- auth ---------- */
export const loginAs = (memberId: string) => { if (!isLive()) mutate((s) => { s.meId = memberId; }); };
export async function logout() {
  if (isLive()) {
    const { supabase } = await import("./supabase");
    await supabase.auth.signOut();
    hydrate();
  }
  mutate((s) => { s.meId = null; });
}
export const setMemberCalendar = (id: string, v: Member["calendar"]) => mutate((s) => { const m = member(s, id); if (m) m.calendar = v; });

/* ---------- CRM ---------- */
// Each action changes the local copy first (instant UI). In live mode it then saves through the API
// (server enforces permissions, writes the activity history and audit) and resyncs.
export const addContact = (c: Pick<Contact, "name" | "phone" | "email" | "companyId">) => {
  let id = "";
  crmLocal((s) => { if (!canDo(s, "crm.create")) return; id = rid("c"); s.contacts.unshift({ ...c, id, tags: [], optedOut: false, custom: {}, createdAt: now(), source: "manual", ownerId: s.meId }); log(s, "contact.created", c.name); });
  if (id && isLive()) void crmRemote("/contacts", "POST", { id, name: c.name, phone: c.phone, email: c.email, companyId: c.companyId }, `${c.name} added`);
  return id;
};
export const updateContact = (id: string, patch: Partial<Pick<Contact, "name" | "phone" | "email" | "companyId">>) => {
  crmLocal((s) => {
    if (!canDo(s, "crm.edit")) return; const c = s.contacts.find((x) => x.id === id); if (!c) return;
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) if (JSON.stringify(c[k]) !== JSON.stringify(patch[k])) act(s, { contactId: id, type: "field", text: `${k} changed` });
    Object.assign(c, patch); touch(s, id, "Edited contact");
  });
  if (isLive()) void crmRemote(`/contacts/${id}`, "PATCH", patch);
};
export const setContactCustom = (id: string, fieldId: string, value: string) => {
  crmLocal((s) => {
    if (!canDo(s, "crm.edit")) return; const c = s.contacts.find((x) => x.id === id); const f = s.fields.find((x) => x.id === fieldId); if (!c || !f) return;
    act(s, { contactId: id, type: "field", text: `${f.name}: ${c.custom[fieldId] || "empty"} → ${value || "empty"}` }); c.custom[fieldId] = value;
  });
  if (isLive()) void crmRemote(`/contacts/${id}`, "PATCH", { custom: { [fieldId]: value } });
};
export const deleteContact = (id: string) => {
  crmLocal((s) => {
    if (!canDo(s, "crm.delete")) return; const c = s.contacts.find((x) => x.id === id); if (!c) return;
    const oppIds = s.opps.filter((o) => o.contactId === id).map((o) => o.id);
    s.opps = s.opps.filter((o) => o.contactId !== id); s.leads = s.leads.filter((l) => l.contactId !== id); s.messages = s.messages.filter((m) => m.contactId !== id);
    s.payments = s.payments.filter((p) => p.contactId !== id && !oppIds.includes(p.oppId)); s.appointments = s.appointments.filter((a) => a.contactId !== id); s.activity = s.activity.filter((a) => a.contactId !== id);
    s.contacts = s.contacts.filter((x) => x.id !== id); log(s, "contact.deleted", c.name);
  });
  if (isLive()) void crmRemote(`/contacts/${id}`, "DELETE", undefined, "Contact deleted");
};
export const setOptOut = (id: string, v: boolean) => {
  crmLocal((s) => { const c = s.contacts.find((x) => x.id === id); if (!c || !canDo(s, "crm.edit")) return; c.optedOut = v; act(s, { contactId: id, type: "message", text: v ? "Marked as opted out of messaging" : "Opt-out removed" }); log(s, "contact.optout", c.name, String(!v), String(v)); });
  if (isLive()) void crmRemote(`/contacts/${id}`, "PATCH", { optedOut: v });
};
const saveTags = (id: string) => { const c = state.contacts.find((x) => x.id === id); if (c && isLive()) void crmRemote(`/contacts/${id}`, "PATCH", { tags: c.tags }); };
export const addTag = (id: string, tag: string) => {
  const t = tag.trim().toLowerCase();
  crmLocal((s) => { const c = s.contacts.find((x) => x.id === id); if (c && t && !c.tags.includes(t) && canDo(s, "crm.edit")) c.tags.push(t); });
  saveTags(id);
};
export const removeTag = (id: string, tag: string) => {
  crmLocal((s) => { const c = s.contacts.find((x) => x.id === id); if (c && canDo(s, "crm.edit")) c.tags = c.tags.filter((t) => t !== tag); });
  saveTags(id);
};
export const addNote = (contactId: string, text: string, oppId?: string) => {
  if (!text.trim()) return;
  crmLocal((s) => { act(s, { contactId, oppId, type: "note", text }); touch(s, contactId, "Added note"); });
  if (isLive()) void crmRemote(`/contacts/${contactId}/notes`, "POST", { text, ...(oppId ? { oppId } : {}) });
};
export const addOpp = (contactId: string, pipelineId: string, title: string, value: number) => {
  let id = "";
  crmLocal((s) => {
    if (!canDo(s, "crm.create")) return; const p = s.pipelines.find((x) => x.id === pipelineId); if (!p?.stages[0]) return;
    id = rid("o");
    s.opps.unshift({ id, title, contactId, pipelineId, stageId: p.stages[0].id, value, custom: {}, ownerId: s.meId, createdAt: now(), version: 1 });
    act(s, { contactId, oppId: id, type: "stage", text: `Opportunity "${title}" created in ${p.name}` }); touch(s, contactId, "Created opportunity");
  });
  if (id && isLive()) void crmRemote("/opportunities", "POST", { id, contactId, pipelineId, title, ...(value && canDo(state, "values.view") ? { value } : {}) }, `"${title}" created`);
};
export const setOppCustom = (oppId: string, fieldId: string, value: string) => {
  const version = oppVersion(oppId);
  crmLocal((s) => {
    const o = s.opps.find((x) => x.id === oppId); const f = s.fields.find((x) => x.id === fieldId); if (!o || !f || !canDo(s, "crm.edit")) return;
    act(s, { contactId: o.contactId, oppId, type: "field", text: `${f.name}: ${o.custom[fieldId] || "empty"} → ${value || "empty"}` }); o.custom[fieldId] = value;
  });
  if (isLive()) void crmRemote(`/opportunities/${oppId}`, "PATCH", { version, custom: { [fieldId]: value } });
};
export const setOppValue = (oppId: string, value: number) => {
  const version = oppVersion(oppId);
  crmLocal((s) => { const o = s.opps.find((x) => x.id === oppId); if (!o || !canDo(s, "crm.edit") || !canDo(s, "values.view")) return; act(s, { contactId: o.contactId, oppId, type: "field", text: `Value: ${o.value} → ${value}` }); o.value = value; });
  if (isLive()) void crmRemote(`/opportunities/${oppId}`, "PATCH", { version, value });
};
export const setOppOwner = (oppId: string, ownerId: string) => {
  const version = oppVersion(oppId);
  crmLocal((s) => { const o = s.opps.find((x) => x.id === oppId); if (!o || !canDo(s, "assignment.manage")) return; act(s, { contactId: o.contactId, oppId, type: "assignment", text: `Owner → ${nameOf(s, ownerId)}` }); o.ownerId = ownerId; });
  if (isLive()) void crmRemote(`/opportunities/${oppId}`, "PATCH", { version, ownerId });
};
export function moveOpp(oppId: string, stageId: string): { ok: boolean; error?: string } {
  let res: { ok: boolean; error?: string } = { ok: true };
  const version = oppVersion(oppId);
  crmLocal((s) => {
    if (!canDo(s, "crm.edit")) { res = { ok: false, error: "You don't have permission to edit records." }; return; }
    const o = s.opps.find((x) => x.id === oppId); const p = s.pipelines.find((x) => x.id === o?.pipelineId); const st = p?.stages.find((x) => x.id === stageId);
    if (!o || !p || !st) { res = { ok: false, error: "Stage not found." }; return; }
    const missing = st.required.filter((fid) => !(o.custom[fid] ?? "").toString().trim());
    if (missing.length) { res = { ok: false, error: `Fill in ${missing.map((m) => s.fields.find((f) => f.id === m)?.name ?? m).join(", ")} before moving to "${st.name}".` }; return; }
    const from = p.stages.find((x) => x.id === o.stageId)?.name; o.stageId = stageId;
    act(s, { contactId: o.contactId, oppId, type: "stage", text: `Moved ${from} → ${st.name}` }); touch(s, o.contactId, "Changed stage");
  });
  // the server re-checks required fields (opportunity_guard) and the version; a refusal is shown and undone
  if (res.ok && isLive()) void crmRemote(`/opportunities/${oppId}`, "PATCH", { version, stageId });
  return res;
}

/* ---------- pipeline & fields config ---------- */
// Same pattern as CRM: local change first, then (live) the API, which audits and the next sync confirms.
const needCfg = (s: State) => canDo(s, "pipelines.manage");
export const addPipeline = (name: string) => {
  const ids = { p: rid("pl"), s: [rid("st"), rid("st"), rid("st")] };
  let ok = false;
  crmLocal((s) => { if (!needCfg(s)) return; ok = true; s.pipelines.push({ id: ids.p, name, stages: [{ id: ids.s[0], name: "New", kind: "open", required: [] }, { id: ids.s[1], name: "Won", kind: "won", required: [] }, { id: ids.s[2], name: "Lost", kind: "lost", required: [] }] }); log(s, "pipeline.created", name); });
  if (ok && isLive()) void crmRemote("/pipelines", "POST", { id: ids.p, name, stageIds: ids.s }, `Pipeline "${name}" created`);
};
export const addStage = (pid: string, name: string) => {
  const id = rid("st"); let ok = false;
  crmLocal((s) => { if (!needCfg(s)) return; const p = s.pipelines.find((x) => x.id === pid); if (!p) return; ok = true; const idx = p.stages.findIndex((x) => x.kind !== "open"); p.stages.splice(idx < 0 ? p.stages.length : idx, 0, { id, name, kind: "open", required: [] }); log(s, "pipeline.stage_added", `${p.name} / ${name}`); });
  if (ok && isLive()) void crmRemote(`/pipelines/${pid}/stages`, "POST", { id, name });
};
export const renameStage = (pid: string, sid: string, name: string) => {
  let ok = false;
  crmLocal((s) => { if (!needCfg(s)) return; const st = s.pipelines.find((x) => x.id === pid)?.stages.find((x) => x.id === sid); if (!st || !name.trim()) return; ok = true; log(s, "pipeline.stage_renamed", st.name, st.name, name); st.name = name; });
  if (ok && isLive()) void crmRemote(`/stages/${sid}`, "PATCH", { name });
};
export const moveStage = (pid: string, sid: string, dir: -1 | 1) => {
  let order: string[] | null = null;
  crmLocal((s) => { if (!needCfg(s)) return; const p = s.pipelines.find((x) => x.id === pid); if (!p) return; const i = p.stages.findIndex((x) => x.id === sid); const j = i + dir; if (i < 0 || j < 0 || j >= p.stages.length) return; [p.stages[i], p.stages[j]] = [p.stages[j], p.stages[i]]; order = p.stages.map((x) => x.id); log(s, "pipeline.stage_reordered", p.stages[j].name); });
  if (order && isLive()) void crmRemote(`/pipelines/${pid}/stage-order`, "PUT", { ids: order });
};
export const setStageRequired = (pid: string, sid: string, fieldIds: string[]) => {
  let ok = false;
  crmLocal((s) => { if (!needCfg(s)) return; const st = s.pipelines.find((x) => x.id === pid)?.stages.find((x) => x.id === sid); if (!st) return; ok = true; log(s, "pipeline.required_fields_changed", st.name, st.required.join(","), fieldIds.join(",")); st.required = fieldIds; });
  if (ok && isLive()) void crmRemote(`/stages/${sid}/required-fields`, "PUT", { fieldIds });
};
/** Deleting a stage that holds opportunities requires a destination stage, so nothing is orphaned. */
export function deleteStage(pid: string, sid: string, moveTo?: string): { ok: boolean; error?: string } {
  let res: { ok: boolean; error?: string } = { ok: true };
  crmLocal((s) => {
    if (!needCfg(s)) { res = { ok: false, error: "No permission." }; return; }
    const p = s.pipelines.find((x) => x.id === pid); const st = p?.stages.find((x) => x.id === sid); if (!p || !st) return;
    if (p.stages.length <= 2) { res = { ok: false, error: "A pipeline needs at least two stages." }; return; }
    const held = s.opps.filter((o) => o.stageId === sid);
    if (held.length && (!moveTo || moveTo === sid || !p.stages.some((x) => x.id === moveTo))) { res = { ok: false, error: `${held.length} opportunities are in this stage. Choose a stage to move them to.` }; return; }
    held.forEach((o) => { o.stageId = moveTo!; act(s, { contactId: o.contactId, oppId: o.id, type: "stage", text: `Stage "${st.name}" deleted; moved to ${p.stages.find((x) => x.id === moveTo)?.name}` }); });
    p.stages = p.stages.filter((x) => x.id !== sid); log(s, "pipeline.stage_deleted", `${p.name} / ${st.name}`, undefined, held.length ? `${held.length} moved` : undefined);
  });
  if (res.ok && isLive()) void crmRemote(`/stages/${sid}${moveTo ? `?moveTo=${moveTo}` : ""}`, "DELETE", undefined, "Stage deleted");
  return res;
}
export const addField = (name: string, type: FieldType, entity: "contact" | "opportunity", pipelineId: string | null, options?: string[]) => {
  const f: CustomField = { id: rid("f"), name, type, entity, pipelineId: entity === "contact" ? null : pipelineId, options };
  let ok = false;
  crmLocal((s) => { if (!needCfg(s) || !name.trim()) return; ok = true; s.fields.push(f); log(s, "field.created", name, undefined, `${type} / ${entity}`); });
  if (ok && isLive()) void crmRemote("/fields", "POST", { id: f.id, name, type, entity, pipelineId: f.pipelineId, ...(options?.length ? { options } : {}) }, `Field "${name}" added`);
};
export const deleteField = (id: string) => {
  let ok = false;
  crmLocal((s) => { if (!needCfg(s)) return; const f = s.fields.find((x) => x.id === id); if (!f) return; ok = true; s.fields = s.fields.filter((x) => x.id !== id); s.pipelines.forEach((p) => p.stages.forEach((st) => { st.required = st.required.filter((r) => r !== id); })); s.opps.forEach((o) => delete o.custom[id]); s.contacts.forEach((c) => delete c.custom[id]); log(s, "field.deleted", f.name); });
  if (ok && isLive()) void crmRemote(`/fields/${id}`, "DELETE", undefined, "Field deleted");
};

/* ---------- lists ---------- */
export const saveList = (name: string, criteria: Criterion[]) => {
  const id = rid("sl");
  mutate((s) => { s.lists.push({ id, name, criteria }); });
  if (isLive()) void crmRemote("/lists", "POST", { id, name, criteria }, `List "${name}" saved`);
};
export const deleteList = (id: string) => {
  mutate((s) => { s.lists = s.lists.filter((l) => l.id !== id); });
  if (isLive()) void crmRemote(`/lists/${id}`, "DELETE");
};
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
  if (isLive()) {
    // the server sends through Twilio; failures come back as a failed message with the reason (I1.7)
    const c = state.contacts.find((x) => x.id === contactId);
    if (!c || !body.trim()) return { ok: false };
    if (c.optedOut) return { ok: false, error: "This contact opted out of messaging. Remove the opt-out only if they ask to be contacted again." };
    void crmRemote(`/contacts/${contactId}/messages`, "POST", { body });
    return res;
  }
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
export const retryMessage = (id: string) => {
  if (isLive()) { void crmRemote(`/messages/${id}/retry`, "POST", undefined, "Retrying…"); return; } const m = state.messages.find((x) => x.id === id); if (!m) return; mutate((s) => { s.messages = s.messages.filter((x) => x.id !== id); }); sendMessage(m.contactId, m.body); };
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

/* ---------- live calendar (M9): Google Calendar through apps/api ---------- */
export type CalConflict = { source: "google" | "platform"; title: string; start: string; end: string };
export type CalResult = { ok: boolean; error?: string; conflicts?: CalConflict[]; warning?: string | null };

export async function syncAppointments() {
  if (!isLive()) return;
  const { api } = await import("./api");
  try {
    const r = await api<{ appointments: Appointment[]; timezones: Record<string, string> }>("/appointments");
    const n = structuredClone(state);
    n.appointments = r.appointments;
    n.members = n.members.map((m) => (r.timezones[m.id] ? { ...m, tz: r.timezones[m.id] } : m));   // I3.5: each employee's own zone
    state = n; save(); emit();
  } catch { /* the next poll or realtime event retries */ }
}
let apptTimer: ReturnType<typeof setTimeout> | undefined;
const scheduleApptSync = () => { clearTimeout(apptTimer); apptTimer = setTimeout(() => void syncAppointments(), 300); };

/** Re-read team + calendar connection status (after the Google consent screen or a disconnect). */
export async function refreshTeam() {
  if (!isLive()) return;
  const { api } = await import("./api");
  try { applyServer(await api("/me")); } catch { /* offline: keep what we have */ }
}

async function calFail(e: unknown): Promise<CalResult> {
  const { ApiError } = await import("./api");
  if (e instanceof ApiError) return { ok: false, error: e.message, conflicts: (e.details as { conflicts?: CalConflict[] } | undefined)?.conflicts };
  return { ok: false, error: "Couldn't reach Google Calendar. Nothing was changed; try again." };
}

/** I3.4: the employee's busy times (Google + platform) for the chosen window. */
export async function fetchBusy(memberId: string, from: number, to: number): Promise<CalConflict[]> {
  const { api } = await import("./api");
  const q = new URLSearchParams({ memberId, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  return (await api<{ busy: CalConflict[] }>(`/calendar/busy?${q}`)).busy;
}

/** Book, move and cancel work in both modes: the server (Google) in live mode, the local demo otherwise. */
export async function bookAppt(a: Omit<Appointment, "id" | "status">, force = false): Promise<CalResult> {
  if (!isLive()) return bookAppointment(a, force);
  const { api } = await import("./api");
  try {
    await api("/appointments", { method: "POST", body: { contactId: a.contactId, oppId: a.oppId, memberId: a.memberId, title: a.title, start: new Date(a.start).toISOString(), end: new Date(a.end).toISOString(), timezone: a.tz, force } });
    await Promise.all([syncAppointments(), syncCrm(), syncLeads()]);   // history and lead acknowledgement change too
    return { ok: true };
  } catch (e) { return calFail(e); }
}
export async function moveAppt(id: string, start: number, end: number, force = false): Promise<CalResult> {
  if (!isLive()) return rescheduleAppointment(id, start, end);
  const { api } = await import("./api");
  try {
    await api(`/appointments/${id}`, { method: "PATCH", body: { start: new Date(start).toISOString(), end: new Date(end).toISOString(), force } });
    await Promise.all([syncAppointments(), syncCrm()]);
    return { ok: true };
  } catch (e) { return calFail(e); }
}
export async function cancelAppt(id: string): Promise<CalResult> {
  if (!isLive()) { cancelAppointment(id); return { ok: true }; }
  const { api } = await import("./api");
  try {
    const r = await api<{ warning?: string | null }>(`/appointments/${id}/cancel`, { method: "POST" });
    await Promise.all([syncAppointments(), syncCrm()]);
    return { ok: true, warning: r.warning };
  } catch (e) { return calFail(e); }
}

/** I3.1: ask the server for Google's consent URL (it holds the client secret) and go there. */
export async function connectGoogleCalendar(): Promise<{ ok: boolean; error?: string }> {
  const { api } = await import("./api");
  try { const { url } = await api<{ url: string }>("/calendar/connect", { method: "POST" }); window.location.assign(url); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't start the Google connection." }; }
}
export async function disconnectGoogleCalendar(memberId?: string): Promise<{ ok: boolean; error?: string }> {
  const { api } = await import("./api");
  try { await api("/calendar/disconnect", { method: "POST", body: memberId ? { memberId } : {} }); await refreshTeam(); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't disconnect." }; }
}

/* ---------- integrations page ---------- */
const providers: Record<IntegrationKey, string[]> = { messaging: ["Twilio WhatsApp Sandbox", "Twilio SMS"], payments: ["Stripe (test mode)"], calendar: ["Google Calendar (OAuth 2.0)"], notifications: ["Slack", "Telegram bot", "Email (Resend)"] };
export const providerOptions = (k: IntegrationKey) => providers[k];
export const connectIntegration = (k: IntegrationKey, provider?: string) => mutate((s) => { if (!canDo(s, "integrations.manage")) return; const i = s.integrations[k]; i.status = "connected"; i.lastOk = now(); if (provider) i.provider = provider; i.errors = []; if (k === "calendar") s.members.forEach((m) => { if (m.calendar === "needs_reconnect") m.calendar = "connected"; }); log(s, "integration.connected", k, undefined, i.provider); });
export const disconnectIntegration = (k: IntegrationKey) => mutate((s) => { if (!canDo(s, "integrations.manage")) return; s.integrations[k].status = "not_connected"; log(s, "integration.disconnected", k); });

/* ---------- misc ---------- */
export const markNotificationsRead = () => mutate((s) => { s.notifications.forEach((n) => { if (n.userId === s.meId) n.read = true; }); });
export const toggleTile = (id: string) => {
  mutate((s) => { if (!s.meId) return; const h = (s.hiddenTiles[s.meId] ??= []); const i = h.indexOf(id); if (i >= 0) h.splice(i, 1); else h.push(id); });
  if (isLive() && state.meId) void remote("/me", "PATCH", { hiddenTiles: state.hiddenTiles[state.meId] ?? [] });
};

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
export const setMyNotifyDest = (dest: string) => {
  if (isLive()) { void remote("/me", "PATCH", { notifyDest: dest }, "Alert destination saved"); return; }
  mutate((s) => { const m = member(s, s.meId); if (m) { m.notifyDest = dest; log(s, "notification.destination_changed", m.name); } });
};
export const simulateDuplicateWebhook = (phone: string) => { simulateIncoming(phone, "Duplicate delivery test", "SMDUP0001"); simulateIncoming(phone, "Duplicate delivery test", "SMDUP0001"); };
