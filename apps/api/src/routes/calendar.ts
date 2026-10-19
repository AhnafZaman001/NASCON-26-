// M9: Google Calendar (I3). Each employee connects their own Google account (OAuth 2.0, I3.1); tokens stay
// encrypted on the server (I3.2). Appointments are created, moved and cancelled on the employee's real calendar
// (I3.3, I3.6), checked against their busy times first (I3.4), and stored in UTC with the booking zone (I3.5).
// Mounted at /api: guards are per route (the OAuth callback is public and protected by a signed state).
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Perm } from "@nascon/ui";
import { supabaseAdmin } from "../lib/supabase.ts";
import { HttpError, dbError, must, parse } from "../lib/http.ts";
import { can, ctxOf, requireMember, requirePerm, type Ctx } from "../middleware/auth.ts";
import { getOwned, logActivity } from "../lib/crm.ts";
import { signState, verifyState } from "../lib/secrets.ts";
import {
  GoogleError, accessToken, authUrl, deleteConnection, deleteEvent, emailFromIdToken, exchangeCode, explainGoogle, freeBusy, googleEnv,
  insertEvent, loadConnection, markNeedsReconnect, patchEvent, primaryTimezone, revokeToken, saveConnection, webUrl, type Busy,
} from "../lib/google.ts";

export const calendar = Router();
const allow = (p: Perm) => [requireMember, requirePerm(p)] as const;
const Id = z.object({ id: z.string().uuid() });
const MAX_MINUTES = 8 * 60;

/* ---------------- sync history (I5.4) ---------------- */
async function gEvent(ws: string | null, direction: "inbound" | "outbound", type: string, status: "ok" | "error" | "rejected", ref: string | null, error?: string) {
  const db = supabaseAdmin();
  await db.from("integration_events").insert({ workspace_id: ws, provider: "google_calendar", direction, event_type: type, external_id: null, status, reference: ref, error: error ?? null });
  if (ws) await db.from("integrations").update(status === "ok" ? { last_ok_at: new Date().toISOString(), updated_at: new Date().toISOString() } : { last_error: error ?? null, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws).eq("provider", "google_calendar");
}

/** Run a Google call for one employee: failures are recorded, dead connections flagged, and surfaced as plain messages (I5.5, I5.8). */
async function gcall<T>(ws: string, memberId: string, type: string, ref: string | null, fn: () => Promise<T>): Promise<T> {
  try { const r = await fn(); await gEvent(ws, "outbound", type, "ok", ref); return r; }
  catch (e) {
    const why = explainGoogle(e);
    await gEvent(ws, "outbound", type, "error", ref, why);
    if (e instanceof HttpError) throw e;
    if (e instanceof GoogleError && e.kind === "auth") { await markNeedsReconnect(ws, memberId); throw new HttpError(409, why); }
    throw new HttpError(e instanceof GoogleError && e.kind === "permanent" ? 400 : 502, why);
  }
}

/* ---------------- connection (I3.1, I3.2, I3.7) ---------------- */
type MemberRow = { id: string; full_name: string; email: string; calendar_status: string; timezone: string | null };

calendar.get("/calendar/status", requireMember, async (req, res) => {
  const ctx = ctxOf(req); const ws = ctx.member.workspaceId; const db = supabaseAdmin();
  const manage = can(ctx, "integrations.manage");
  const [members, mine, events] = await Promise.all([
    db.from("members").select("id, full_name, email, calendar_status, timezone").eq("workspace_id", ws),
    loadConnection(ws, ctx.member.id),
    manage ? db.from("integration_events").select("id, direction, event_type, status, reference, error, created_at").eq("workspace_id", ws).eq("provider", "google_calendar").order("id", { ascending: false }).limit(25) : Promise.resolve({ data: [], error: null }),
  ]);
  res.json({
    configured: !!googleEnv(),
    redirectUri: manage ? googleEnv()?.redirect ?? null : null,
    myEmail: mine?.email ?? null,
    members: (must(members) as MemberRow[]).map((m) => ({ id: m.id, name: m.full_name || m.email, status: m.calendar_status, timezone: m.timezone })),
    events: (must(events) as { id: number; direction: string; event_type: string; status: string; reference: string | null; error: string | null; created_at: string }[])
      .map((e) => ({ id: e.id, direction: e.direction, type: e.event_type, status: e.status, ref: e.reference, error: e.error, at: new Date(e.created_at).getTime() })),
  });
});

// The browser can't send a Bearer token on a redirect, so the SPA asks for the consent URL and navigates to it.
calendar.post("/calendar/connect", requireMember, async (req, res) => {
  const ctx = ctxOf(req);
  if (!googleEnv()) throw new HttpError(503, "Google Calendar isn't configured on the server yet. An admin needs to add the Google client ID and secret.");
  res.json({ url: authUrl(signState({ w: ctx.member.workspaceId, m: ctx.member.id }), ctx.user.email ?? undefined) });
});

const back = (res: import("express").Response, q: Record<string, string>) => res.redirect(`${webUrl()}/integrations?${new URLSearchParams(q)}`);

// Public: Google redirects the browser here. The signed, expiring state says who started the flow.
calendar.get("/calendar/callback", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const st = verifyState<{ w: string; m: string }>(q.state);
  if (!st) { await gEvent(null, "inbound", "oauth_callback", "rejected", null, "Invalid or expired state"); return void back(res, { calendar: "error", reason: "That connection link expired. Start again from the Integrations page." }); }
  if (q.error) return void back(res, { calendar: q.error === "access_denied" ? "denied" : "error", reason: q.error === "access_denied" ? "You declined access, so nothing was connected." : "Google reported a problem: " + q.error });
  if (!q.code) return void back(res, { calendar: "error", reason: "Google didn't return an authorization code." });
  try {
    const t = await exchangeCode(q.code);
    if (!t.refresh_token) throw new HttpError(400, "Google didn't allow ongoing access. Remove this app at myaccount.google.com/permissions, then connect again.");
    const email = emailFromIdToken(t.id_token);
    const tz = await primaryTimezone(t.access_token).catch(() => null);
    await saveConnection(st.w, st.m, { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000, email });
    must(await supabaseAdmin().rpc("api_calendar_set_status", { p_actor: st.m, p_ws: st.w, p_member: st.m, p_status: "connected", p_tz: tz }));
    await gEvent(st.w, "inbound", "oauth_connected", "ok", email);
    back(res, { calendar: "connected" });
  } catch (e) {
    const why = explainGoogle(e);
    await gEvent(st.w, "inbound", "oauth_callback", "error", null, why);
    if (e instanceof GoogleError && e.kind === "permanent") return void back(res, { calendar: "error", reason: "Google refused the connection. If the app is in testing mode, your Google account must be listed as a test user." });
    back(res, { calendar: "error", reason: why });
  }
});

const Disconnect = z.object({ memberId: z.string().uuid().optional() }).strict();
calendar.post("/calendar/disconnect", requireMember, async (req, res) => {
  const ctx = ctxOf(req); const ws = ctx.member.workspaceId;
  const { memberId = ctx.member.id } = parse(Disconnect, req.body ?? {});
  if (memberId !== ctx.member.id && !can(ctx, "integrations.manage")) throw new HttpError(403, "You can only disconnect your own calendar.");
  await getOwned(ctx, memberId, "members");
  const c = await loadConnection(ws, memberId);
  if (c) await revokeToken(c.refresh_token).catch(() => {});   // best effort: the stored copy is deleted either way
  await deleteConnection(ws, memberId);
  must(await supabaseAdmin().rpc("api_calendar_set_status", { p_actor: ctx.member.id, p_ws: ws, p_member: memberId, p_status: "not_connected", p_tz: null }));
  await gEvent(ws, "outbound", "disconnect", "ok", memberId);
  res.json({ ok: true });
});

/* ---------------- busy times and conflicts (I3.4) ---------------- */
type Conflict = { source: "google" | "platform"; title: string; start: string; end: string };
const within = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start >= b.start && a.end <= b.end;
const span = (s: string, e: string) => ({ start: new Date(s).getTime(), end: new Date(e).getTime() });

/** Overlaps from the platform's own appointments and from Google. `ignore` is the appointment being moved. */
async function findConflicts(ws: string, memberId: string, token: string, start: Date, end: Date, ignore?: { id: string; starts_at: string; ends_at: string }): Promise<Conflict[]> {
  let q = supabaseAdmin().from("appointments").select("id, title, starts_at, ends_at").eq("workspace_id", ws).eq("member_id", memberId).eq("status", "scheduled")
    .lt("starts_at", end.toISOString()).gt("ends_at", start.toISOString());
  if (ignore) q = q.neq("id", ignore.id);
  const local = (must(await q) as { id: string; title: string; starts_at: string; ends_at: string }[])
    .map((a): Conflict => ({ source: "platform", title: a.title, start: a.starts_at, end: a.ends_at }));
  const own = ignore ? span(ignore.starts_at, ignore.ends_at) : null;
  const google = (await freeBusy(token, start, end))
    .filter((b) => !(own && within(span(b.start, b.end), own)))                                 // the event being moved
    .filter((b) => !local.some((l) => within(span(b.start, b.end), span(l.start, l.end))))     // already counted as a platform appointment
    .map((b: Busy): Conflict => ({ source: "google", title: "Busy in Google Calendar", start: b.start, end: b.end }));
  return [...local, ...google];
}

function bookable(m: MemberRow) {
  if (m.calendar_status === "connected") return;
  const who = m.full_name || m.email;
  throw new HttpError(409, m.calendar_status === "needs_reconnect"
    ? `${who}'s Google connection expired. They need to reconnect their calendar before they can be booked.`
    : `${who} hasn't connected a Google Calendar, so they can't be booked.`);
}

const Range = z.object({ memberId: z.string().uuid(), from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) });
calendar.get("/calendar/busy", ...allow("crm.view"), async (req, res) => {
  const ctx = ctxOf(req); const ws = ctx.member.workspaceId;
  const q = parse(Range, req.query);
  const from = new Date(q.from), to = new Date(q.to);
  if (!(to > from) || to.getTime() - from.getTime() > 14 * 86_400_000) throw new HttpError(400, "Ask for at most 14 days at a time.");
  const m = await getOwned<MemberRow>(ctx, q.memberId, "members", "id, full_name, email, calendar_status, timezone");
  bookable(m);
  const token = await accessToken(ws, m.id);
  const conflicts = await gcall(ws, m.id, "freebusy", null, () => findConflicts(ws, m.id, token, from, to));
  res.json({ busy: conflicts });
});

/* ---------------- appointments (I3.3, I3.5, I3.6) ---------------- */
const COLS = "id, contact_id, opportunity_id, member_id, title, starts_at, ends_at, timezone, google_event_id, status, created_by, html_link";
type ApptRow = { id: string; contact_id: string | null; opportunity_id: string | null; member_id: string; title: string; starts_at: string; ends_at: string; timezone: string; google_event_id: string | null; status: "scheduled" | "cancelled"; created_by: string | null; html_link: string | null };
const apptDto = (a: ApptRow) => ({
  id: a.id, contactId: a.contact_id ?? "", oppId: a.opportunity_id, memberId: a.member_id, title: a.title,
  start: new Date(a.starts_at).getTime(), end: new Date(a.ends_at).getTime(), status: a.status === "cancelled" ? "cancelled" : "confirmed", tz: a.timezone, link: a.html_link,
});
const companyWide = (ctx: Ctx) => ctx.member.level !== "user" || can(ctx, "assignment.manage");

calendar.get("/appointments", ...allow("crm.view"), async (req, res) => {
  const ctx = ctxOf(req); const ws = ctx.member.workspaceId; const db = supabaseAdmin();
  let q = db.from("appointments").select(COLS).eq("workspace_id", ws).gte("ends_at", new Date(Date.now() - 90 * 86_400_000).toISOString()).order("starts_at").limit(1000);
  if (!companyWide(ctx)) q = q.or(`member_id.eq.${ctx.member.id},created_by.eq.${ctx.member.id}`);
  const [rows, zones] = await Promise.all([q, db.from("members").select("id, timezone").eq("workspace_id", ws)]);
  res.json({
    appointments: (must(rows) as ApptRow[]).map(apptDto),
    timezones: Object.fromEntries((must(zones) as { id: string; timezone: string | null }[]).filter((z) => z.timezone).map((z) => [z.id, z.timezone])),
  });
});

const Tz = z.string().max(64).refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }, "Unknown time zone.");
const When = { start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), timezone: Tz };
const NewAppt = z.object({
  contactId: z.string().uuid(), oppId: z.string().uuid().nullish(), memberId: z.string().uuid(),
  title: z.string().trim().min(1, "Give the appointment a title.").max(160), ...When, force: z.boolean().default(false),
}).strict();
const Move = z.object({ start: When.start, end: When.end, timezone: Tz.optional(), force: z.boolean().default(false) }).strict();

function checkTimes(start: Date, end: Date) {
  if (!(end > start)) throw new HttpError(400, "The appointment must end after it starts.");
  if (end.getTime() - start.getTime() > MAX_MINUTES * 60_000) throw new HttpError(400, "Appointments can be at most 8 hours long.");
  if (start.getTime() < Date.now() - 5 * 60_000) throw new HttpError(400, "That start time is in the past.");
}

const fmt = (d: Date, tz: string) => d.toLocaleString("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
const overlapMsg = (c: Conflict[]) => `That time overlaps ${c.length === 1 ? "another busy slot" : `${c.length} busy slots`} on the employee's calendar.`;

async function loadAppt(ctx: Ctx, id: string) {
  const { data } = await supabaseAdmin().from("appointments").select(COLS).eq("id", id).eq("workspace_id", ctx.member.workspaceId).maybeSingle();
  if (!data) throw new HttpError(404, "Appointment not found.");
  const a = data as ApptRow;
  if (!companyWide(ctx) && a.member_id !== ctx.member.id && a.created_by !== ctx.member.id) throw new HttpError(404, "Appointment not found.");
  return a;
}

const eventInput = (a: { id: string; title: string; start: Date; end: Date; tz: string; ws: string; contact: { id: string; full_name: string; phone: string | null; email: string | null } | null }) => ({
  summary: a.title, start: a.start, end: a.end, timeZone: a.tz, appointmentId: a.id, workspaceId: a.ws,
  description: a.contact ? [`Customer: ${a.contact.full_name}`, a.contact.phone && `Phone: ${a.contact.phone}`, a.contact.email && `Email: ${a.contact.email}`, `Open in the CRM: ${webUrl()}/contacts/${a.contact.id}`].filter(Boolean).join("\n") : undefined,
});

calendar.post("/appointments", ...allow("crm.view"), async (req, res) => {
  const ctx = ctxOf(req); const ws = ctx.member.workspaceId; const db = supabaseAdmin();
  const b = parse(NewAppt, req.body);
  const start = new Date(b.start), end = new Date(b.end);
  checkTimes(start, end);
  const contact = await getOwned<{ id: string; full_name: string; phone: string | null; email: string | null }>(ctx, b.contactId, "contacts", "id, full_name, phone, email");
  if (b.oppId) {
    const { data } = await db.from("opportunities").select("id").eq("id", b.oppId).eq("workspace_id", ws).eq("contact_id", contact.id).maybeSingle();
    if (!data) throw new HttpError(404, "Opportunity not found for this contact.");
  }
  const target = await getOwned<MemberRow>(ctx, b.memberId, "members", "id, full_name, email, calendar_status, timezone");
  bookable(target);   // I3.7: no connected calendar, no booking, and the message says why

  const id = randomUUID();
  const token = await accessToken(ws, target.id);
  const conflicts = await gcall(ws, target.id, "freebusy", id, () => findConflicts(ws, target.id, token, start, end));
  if (conflicts.length && !b.force) throw new HttpError(409, overlapMsg(conflicts), { conflicts });

  const ev = await gcall(ws, target.id, "event_create", id, () => insertEvent(token, eventInput({ id, title: b.title, start, end, tz: b.timezone, ws, contact })));
  const ins = await db.from("appointments").insert({
    id, workspace_id: ws, contact_id: contact.id, opportunity_id: b.oppId ?? null, member_id: target.id, title: b.title,
    starts_at: start.toISOString(), ends_at: end.toISOString(), timezone: b.timezone, google_event_id: ev.id, html_link: ev.htmlLink ?? null,
    status: "scheduled", created_by: ctx.member.id, allow_overlap: conflicts.length > 0,
  }).select(COLS).single();
  if (ins.error) {
    await deleteEvent(token, ev.id).catch(() => {});   // don't leave an orphan event in Google
    if (ins.error.code === "23P01") throw new HttpError(409, "Someone just booked that slot. Pick another time.");
    throw dbError(ins.error)!;
  }
  await logActivity(ws, ctx.member.id, { contactId: contact.id, oppId: b.oppId ?? null, type: "appointment", text: `Booked "${b.title}" with ${target.full_name || target.email} for ${fmt(start, b.timezone)} (${b.timezone})` });
  await db.rpc("api_touch_contact_leads", { p_actor: ctx.member.id, p_ws: ws, p_contact: contact.id });   // a recorded action acknowledges the lead
  res.status(201).json({ appointment: apptDto(ins.data as ApptRow), overlapped: conflicts.length > 0 });
});

calendar.patch("/appointments/:id", ...allow("crm.view"), async (req, res) => {
  const ctx = ctxOf(req); const ws = ctx.member.workspaceId; const db = supabaseAdmin();
  const { id } = parse(Id, req.params);
  const b = parse(Move, req.body);
  const a = await loadAppt(ctx, id);
  if (a.status !== "scheduled") throw new HttpError(400, "This appointment was cancelled.");
  const start = new Date(b.start), end = new Date(b.end), tz = b.timezone ?? a.timezone;
  checkTimes(start, end);
  const target = await getOwned<MemberRow>(ctx, a.member_id, "members", "id, full_name, email, calendar_status, timezone");
  bookable(target);
  if (!a.google_event_id) throw new HttpError(409, "This appointment has no Google event to update.");
  const token = await accessToken(ws, target.id);
  const conflicts = await gcall(ws, target.id, "freebusy", id, () => findConflicts(ws, target.id, token, start, end, { id, starts_at: a.starts_at, ends_at: a.ends_at }));
  if (conflicts.length && !b.force) throw new HttpError(409, overlapMsg(conflicts), { conflicts });

  const { data: contact } = a.contact_id ? await db.from("contacts").select("id, full_name, phone, email").eq("id", a.contact_id).eq("workspace_id", ws).maybeSingle() : { data: null };
  const input = (s: Date, e: Date, z: string) => eventInput({ id, title: a.title, start: s, end: e, tz: z, ws, contact });
  const ev = await gcall(ws, target.id, "event_update", id, () => patchEvent(token, a.google_event_id!, input(start, end, tz)));
  const upd = await db.from("appointments").update({ starts_at: start.toISOString(), ends_at: end.toISOString(), timezone: tz, html_link: ev.htmlLink ?? a.html_link, allow_overlap: conflicts.length > 0, updated_at: new Date().toISOString() })
    .eq("id", id).eq("workspace_id", ws).select(COLS).single();
  if (upd.error) {
    await patchEvent(token, a.google_event_id, input(new Date(a.starts_at), new Date(a.ends_at), a.timezone)).catch(() => {});   // put Google back
    if (upd.error.code === "23P01") throw new HttpError(409, "Someone just booked that slot. Pick another time.");
    throw dbError(upd.error)!;
  }
  await logActivity(ws, ctx.member.id, { contactId: a.contact_id, oppId: a.opportunity_id, type: "appointment", text: `Rescheduled "${a.title}" to ${fmt(start, tz)} (${tz})` });
  res.json({ appointment: apptDto(upd.data as ApptRow), overlapped: conflicts.length > 0 });
});

calendar.post("/appointments/:id/cancel", ...allow("crm.view"), async (req, res) => {
  const ctx = ctxOf(req); const ws = ctx.member.workspaceId; const db = supabaseAdmin();
  const { id } = parse(Id, req.params);
  const a = await loadAppt(ctx, id);
  if (a.status === "cancelled") return void res.json({ appointment: apptDto(a) });   // idempotent
  let warning: string | null = null;
  if (a.google_event_id) {
    try {
      const token = await accessToken(ws, a.member_id);
      await gcall(ws, a.member_id, "event_delete", id, () => deleteEvent(token, a.google_event_id!));
    } catch (e) {
      // A dead connection can't be fixed by retrying: cancel here and say the Google event needs removing by hand.
      if (e instanceof HttpError && e.status === 409) warning = "Cancelled here, but the Google event couldn't be removed because the calendar is disconnected. Delete it in Google Calendar.";
      else throw e;   // temporary Google trouble: nothing changed, the user can retry
    }
  }
  const upd = must(await db.from("appointments").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", ws).select(COLS).single()) as ApptRow;
  await logActivity(ws, ctx.member.id, { contactId: a.contact_id, oppId: a.opportunity_id, type: "appointment", text: `Cancelled "${a.title}"` });
  res.json({ appointment: apptDto(upd), warning });
});
