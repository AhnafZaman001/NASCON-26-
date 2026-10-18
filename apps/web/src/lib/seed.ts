import { ALL_PERM_KEYS } from "@nascon/ui";
import type { State, Integration, Pipeline, Member, Perm, Role } from "./types";

const H = 3600_000, D = 24 * H;
const ALL: Perm[] = ALL_PERM_KEYS;
const emptyInt = (provider: string): Integration => ({ status: "not_connected", lastOk: null, errors: [], provider });

export function emptyState(): State {
  return {
    mode: "demo", hydrated: false, roles: [], workspace: { id: "ws_0", name: "" }, meId: null, members: [], companies: [], contacts: [],
    fields: [], pipelines: [], opps: [], leads: [], messages: [], payments: [], appointments: [], activity: [],
    audit: [], notifications: [],
    integrations: { messaging: emptyInt("Twilio WhatsApp Sandbox"), payments: emptyInt("Stripe (test mode)"), calendar: emptyInt("Google Calendar (OAuth 2.0)"), notifications: emptyInt("Slack") },
    sync: [], lists: [], settings: defaultSettings(), rr: -1, hiddenTiles: {},
  };
}
export function defaultSettings(): State["settings"] {
  return {
    maxOpenLeads: 5, idleSeconds: 300, backupId: null, managerId: null, ackedOnAbsence: "keep",
    levels: [{ target: "assignee", seconds: 30 }, { target: "next", seconds: 30 }, { target: "backup", seconds: 30 }, { target: "manager", seconds: 60 }],
  };
}
export const defaultPipelines = (): Pipeline[] => [
  { id: "pl_sales", name: "Sales", stages: [
    { id: "st_new", name: "New", kind: "open", required: [] },
    { id: "st_qual", name: "Qualified", kind: "open", required: [] },
    { id: "st_prop", name: "Proposal", kind: "open", required: ["f_budget"] },
    { id: "st_neg", name: "Negotiation", kind: "open", required: [] },
    { id: "st_won", name: "Won", kind: "won", required: [] },
    { id: "st_lost", name: "Lost", kind: "lost", required: [] },
  ] },
  { id: "pl_inst", name: "Installations", stages: [
    { id: "si_survey", name: "Site survey", kind: "open", required: ["f_roof"] },
    { id: "si_quote", name: "Quoted", kind: "open", required: [] },
    { id: "si_done", name: "Installed", kind: "won", required: [] },
    { id: "si_drop", name: "Dropped", kind: "lost", required: [] },
  ] },
];
export const defaultFields = (): State["fields"] => [
  { id: "f_time", name: "Preferred contact time", type: "dropdown", entity: "contact", pipelineId: null, options: ["Morning", "Afternoon", "Evening"] },
  { id: "f_budget", name: "Budget range", type: "dropdown", entity: "opportunity", pipelineId: "pl_sales", options: ["< $50k", "$50k - $150k", "$150k+"] },
  { id: "f_ptype", name: "Property type", type: "dropdown", entity: "opportunity", pipelineId: "pl_sales", options: ["Apartment", "House", "Plot", "Commercial"] },
  { id: "f_roof", name: "Roof area (sqm)", type: "number", entity: "opportunity", pipelineId: "pl_inst" },
  { id: "f_insp", name: "Inspection date", type: "date", entity: "opportunity", pipelineId: "pl_inst" },
];

/** Blank workspace for sign-up: the first user becomes Owner. */
export function blankWorkspace(company: string, name: string, email: string): State {
  const s = emptyState();
  const t = Date.now();
  const owner: Member = { id: "m_owner", name, email, level: "owner", roleId: null, roleName: "Owner", perms: ALL, status: "available", notifyDest: email, calendar: "none", tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
  s.hydrated = true; s.workspace = { id: "ws_" + t.toString(36), name: company }; s.meId = owner.id;
  s.members = [owner]; s.roles = defaultRoles(); s.pipelines = defaultPipelines(); s.fields = defaultFields();
  s.settings.managerId = owner.id; s.settings.backupId = owner.id;
  s.audit.push({ id: "au_0", at: t, actor: owner.id, type: "workspace.created", target: company });
  return s;
}

export function makeSeed(): State {
  const t = Date.now();
  const s = emptyState();
  const tz = "Asia/Karachi";
  const roles = demoRoles(); s.roles = roles;
  const mk = (id: string, name: string, level: Member["level"], roleId: string | null, status: Member["status"], cal: Member["calendar"]): Member => {
    const role = roles.find((r) => r.id === roleId);
    return { id, name, email: name.split(" ")[0].toLowerCase() + "@skyline.example", level, roleId, roleName: level === "owner" ? "Owner" : role?.name ?? "No role", perms: level === "owner" ? ALL : role?.perms ?? [], status, notifyDest: "@" + name.split(" ")[0].toLowerCase(), calendar: cal, tz };
  };
  s.hydrated = true; s.workspace = { id: "ws_demo", name: "Skyline Realty" }; s.meId = null;
  s.members = [
    mk("m_owner", "Sana Malik", "owner", null, "available", "connected"),
    mk("m_admin", "Hamza Qureshi", "admin", "r_admin", "available", "connected"),
    mk("m_mgr", "Areeba Khan", "user", "r_mgr", "available", "needs_reconnect"),
    mk("m_bilal", "Bilal Ahmed", "user", "r_agent", "available", "connected"),
    mk("m_zoya", "Zoya Siddiqui", "user", "r_senior", "busy", "none"),
    mk("m_usman", "Usman Tariq", "user", "r_support", "offline", "none"),
  ];
  s.settings.managerId = "m_mgr"; s.settings.backupId = "m_admin"; s.pipelines = defaultPipelines(); s.fields = defaultFields();
  s.companies = [
    { id: "co_1", name: "Gulberg Heights" }, { id: "co_2", name: "Bahria Traders" }, { id: "co_3", name: "Nova Clinics" }, { id: "co_4", name: "Eastside Mills" },
  ];
  const c = (id: string, name: string, phone: string, co: string | null, tags: string[], ageH: number, source: string, extra: Partial<State["contacts"][0]> = {}) =>
    s.contacts.push({ id, name, phone, email: name.split(" ")[0].toLowerCase() + "@mail.example", companyId: co, tags, optedOut: false, custom: {}, createdAt: t - ageH * H, source, ...extra });
  c("c1", "Faisal Rehman", "+923001234501", "co_1", ["vip", "investor"], 70, "web form");
  c("c2", "Mariam Aslam", "+923001234502", null, ["first-time"], 50, "whatsapp");
  c("c3", "Omar Javed", "+923001234503", "co_2", ["investor"], 120, "manual");
  c("c4", "Hina Butt", "+923001234504", "co_3", ["referral"], 30, "web form", { custom: { f_time: "Evening" } });
  c("c5", "Danish Iqbal", "+923001234505", null, ["first-time"], 20, "whatsapp");
  c("c6", "Rabia Shah", "+923001234506", "co_4", ["vip"], 240, "web form");
  c("c7", "Kashif Mehmood", "+923001234507", null, [], 6, "web form");
  c("c8", "Ayesha Noor", "+923001234508", "co_1", ["referral"], 2, "whatsapp");
  c("c9", "Tariq Anwar", "+923001234509", null, ["opted-out"], 400, "manual", { optedOut: true });
  c("c10", "Sidra Yousaf", "+923001234510", "co_2", ["investor", "vip"], 160, "web form");
  const o = (id: string, title: string, cid: string, pl: string, st: string, value: number, owner: string | null, custom: Record<string, string> = {}) =>
    s.opps.push({ id, title, contactId: cid, pipelineId: pl, stageId: st, value, ownerId: owner, custom, createdAt: t - 40 * H });
  o("o1", "3-bed apartment, Gulberg", "c1", "pl_sales", "st_prop", 180000, "m_bilal", { f_budget: "$150k+", f_ptype: "Apartment" });
  o("o2", "Commercial plot, Bahria", "c3", "pl_sales", "st_qual", 95000, "m_zoya", { f_ptype: "Plot" });
  o("o3", "Villa purchase", "c6", "pl_sales", "st_neg", 320000, "m_bilal", { f_budget: "$150k+", f_ptype: "House" });
  o("o4", "Starter flat", "c2", "pl_sales", "st_new", 45000, "m_zoya");
  o("o5", "Office floor lease", "c10", "pl_sales", "st_won", 120000, "m_mgr", { f_budget: "$50k - $150k" });
  o("o6", "Solar roof array, clinic", "c4", "pl_inst", "si_survey", 38000, "m_bilal", { f_roof: "220" });
  o("o7", "Rooftop solar, mill", "c6", "pl_inst", "si_quote", 210000, "m_zoya", { f_roof: "900" });
  const lead = (id: string, cid: string, source: string, ageS: number, patch: Partial<State["leads"][0]>) =>
    s.leads.push({ id, contactId: cid, source, createdAt: t - ageS * 1000, status: "acknowledged", ownerId: "m_bilal", assignedAt: t - ageS * 1000, firstAssignedAt: t - ageS * 1000,
      deadlineAt: null, ackedAt: t - (ageS - 40) * 1000, ackedBy: "m_bilal", lastActionAt: t - (ageS - 40) * 1000, level: 0, escalations: 0, exhausted: false,
      history: [{ at: t - ageS * 1000, from: null, to: patch.ownerId ?? "m_bilal", kind: "assign", reason: "Round-robin" }], ...patch });
  lead("l1", "c1", "web form", 5 * 3600, { ownerId: "m_bilal" });
  lead("l2", "c3", "manual", 9 * 3600, { ownerId: "m_zoya", ackedBy: "m_zoya" });
  lead("l3", "c5", "whatsapp", 40, { status: "assigned", ownerId: "m_bilal", ackedAt: null, ackedBy: null, deadlineAt: t + 25_000 });
  lead("l4", "c7", "web form", 20 * 60, { ownerId: "m_zoya", level: 2, escalations: 2, ackedBy: "m_zoya", ackedAt: t - 60_000, lastActionAt: t - 12 * 60_000,
    history: [
      { at: t - 20 * 60_000, from: null, to: "m_usman", kind: "assign", reason: "Round-robin" },
      { at: t - 18 * 60_000, from: "m_usman", to: "m_bilal", kind: "escalate", reason: "Acknowledgement window expired" },
      { at: t - 15 * 60_000, from: "m_bilal", to: "m_zoya", kind: "escalate", reason: "Acknowledgement window expired" },
      { at: t - 60_000, from: "m_zoya", to: "m_zoya", kind: "acknowledge", reason: "Acknowledged" },
    ] });
  lead("l5", "c8", "whatsapp", 90, { status: "unassigned", ownerId: null, assignedAt: null, ackedAt: null, ackedBy: null, deadlineAt: null, history: [] });
  const m = (id: string, cid: string, dir: "in" | "out", body: string, agoS: number, status: State["messages"][0]["status"]) =>
    s.messages.push({ id, contactId: cid, direction: dir, body, at: t - agoS * 1000, status, ref: "SM" + id, by: dir === "out" ? "m_bilal" : undefined });
  m("m1", "c1", "in", "Hi, is the Gulberg apartment still available?", 5 * 3600, "received");
  m("m2", "c1", "out", "Yes! Can we schedule a viewing this week?", 5 * 3600 - 300, "delivered");
  m("m3", "c5", "in", "Hello, I saw your listing for a 2 bed.", 40, "received");
  m("m4", "c8", "in", "Do you have anything near Bahria?", 90, "received");
  m("m5", "c9", "out", "Reminder about your viewing", 30 * D / 1000, "failed");
  s.messages[s.messages.length - 1].error = "Contact opted out (STOP received)";
  s.payments = [
    { id: "p1", oppId: "o5", contactId: "c10", amount: 12000, currency: "USD", at: t - 3 * D, status: "paid", requestedBy: "m_mgr", ref: "pi_3Qx81a", link: "https://checkout.stripe.com/c/pay/test_a1" },
    { id: "p2", oppId: "o1", contactId: "c1", amount: 5000, currency: "USD", at: t - 2 * H, status: "pending", requestedBy: "m_bilal", ref: "cs_test_b2c9", link: "https://checkout.stripe.com/c/pay/test_b2" },
  ];
  s.appointments = [
    { id: "a1", contactId: "c1", oppId: "o1", memberId: "m_bilal", title: "Apartment viewing", start: t + 20 * H, end: t + 21 * H, status: "confirmed", tz },
    { id: "a2", contactId: "c6", oppId: "o3", memberId: "m_bilal", title: "Contract review", start: t + 2 * D, end: t + 2 * D + H, status: "confirmed", tz },
  ];
  s.activity = [
    { id: "ac1", contactId: "c1", at: t - 5 * H, actor: "m_bilal", type: "lead", text: "Lead acknowledged" },
    { id: "ac2", contactId: "c1", oppId: "o1", at: t - 4 * H, actor: "m_bilal", type: "stage", text: "Moved to Proposal" },
    { id: "ac3", contactId: "c1", at: t - 3 * H, actor: "m_bilal", type: "note", text: "Prefers calls after 5pm. Wants a parking spot." },
  ];
  s.integrations.messaging = { ...s.integrations.messaging, status: "connected", lastOk: t - 40_000 };
  s.integrations.payments = { ...s.integrations.payments, status: "connected", lastOk: t - 2 * H };
  s.integrations.notifications = { ...s.integrations.notifications, status: "connected", lastOk: t - 15 * 60_000 };
  s.integrations.calendar = { ...s.integrations.calendar, status: "error", lastOk: t - 2 * D, errors: [{ at: t - 2 * D, text: "Token revoked for areeba@skyline.example - reconnect needed" }] };
  s.lists = [{ id: "sl1", name: "VIP investors", criteria: [{ field: "tag", value: "vip" }, { field: "tag", value: "investor" }, { field: "createdDays", value: "30" }] }];
  s.audit = [
    { id: "au1", at: t - 6 * H, actor: "m_admin", type: "pipeline.stage_renamed", target: "Sales / Proposal", before: "Offer", after: "Proposal" },
    { id: "au2", at: t - 5 * H, actor: "m_owner", type: "permission.changed", target: "Zoya Siddiqui", before: "no values.view", after: "values.view" },
    { id: "au3", at: t - 20 * 60_000, actor: "system", type: "lead.escalated", target: "Kashif Mehmood", before: "Usman Tariq", after: "Bilal Ahmed" },
  ];
  return s;
}

/** Same three roles bootstrap_workspace() creates for a real workspace (supabase/migrations/0010). */
export const defaultRoles = (): Role[] => [
  { id: "r_admin", name: "Admin", perms: ALL },
  { id: "r_manager", name: "Manager", perms: ["crm.view", "crm.create", "crm.edit", "crm.export", "values.view", "conversations.view_all", "dashboard.company", "leads.manage"] },
  { id: "r_sales", name: "Sales", perms: ["crm.view", "crm.create", "crm.edit"] },
];
const demoRoles = (): Role[] => [
  { id: "r_admin", name: "Admin", perms: ALL },
  { id: "r_mgr", name: "Sales Manager", perms: ["crm.view", "crm.create", "crm.edit", "crm.export", "values.view", "assignment.manage", "audit.view"] },
  { id: "r_agent", name: "Sales Agent", perms: ["crm.view", "crm.create", "crm.edit"] },
  { id: "r_senior", name: "Senior Agent", perms: ["crm.view", "crm.create", "crm.edit", "values.view"] },
  { id: "r_support", name: "Support", perms: ["crm.view", "crm.edit"] },
];
