// M7: WhatsApp messaging through Twilio (I1). Inbound messages arrive two ways, both idempotent on
// the Twilio message SID (unique index messages_sid_uq, I1.8):
//   1. signed webhook POST /api/webhooks/twilio/:workspaceId (needs a public URL)  — I1.1, I1.2
//   2. a 5 s poller of Twilio's message log (works on localhost, no tunnel)
// Mounted at /api: guards are per route.
import express, { Router } from "express";
import { z } from "zod";
import type { Perm } from "@nascon/ui";
import { supabaseAdmin } from "../lib/supabase.ts";
import { HttpError, must, parse } from "../lib/http.ts";
import { can, ctxOf, requireMember, requirePerm, type Ctx } from "../middleware/auth.ts";
import { logActivity } from "../lib/crm.ts";
import { explain, fromWhatsApp, recentMessages, sendWhatsApp, twilioEnv, validSignature, type TwilioMessage } from "../lib/twilio.ts";
import { createLead } from "./leads.ts";

export const messaging = Router();
const allow = (p: Perm) => [requireMember, requirePerm(p)] as const;
const Id = z.object({ id: z.string().uuid() });

const STATUS: Record<string, string> = { accepted: "queued", queued: "queued", sending: "queued", sent: "sent", delivered: "delivered", read: "read", failed: "failed", undelivered: "failed", received: "received", receiving: "received" };

async function event(ws: string | null, direction: "inbound" | "outbound", type: string, status: "ok" | "error" | "rejected" | "duplicate", ref: string | null, error?: string) {
  await supabaseAdmin().from("integration_events").insert({ workspace_id: ws, provider: "twilio", direction, event_type: type, external_id: ref, status, reference: ref, error: error ?? null });
  if (ws) await supabaseAdmin().from("integrations").update(status === "error" ? { status: "error", last_error: error ?? null, updated_at: new Date().toISOString() }
    : { status: "connected", last_ok_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("workspace_id", ws).eq("provider", "twilio");
}

/** Known number -> attach to the contact; unknown -> new contact + lead through the lead engine (I1.5, F3.1). */
async function handleInbound(ws: string, m: { sid: string; from: string; body: string }) {
  const db = supabaseAdmin();
  const dup = await db.from("messages").select("id").eq("workspace_id", ws).eq("provider_sid", m.sid).maybeSingle();
  if (dup.data) return false;
  const phone = fromWhatsApp(m.from);
  let contactId = (await db.from("contacts").select("id").eq("workspace_id", ws).eq("phone", phone).maybeSingle()).data?.id as string | undefined;
  let leadId: string | null = null;
  if (!contactId) {
    const r = await createLead(ws, { name: `WhatsApp ${phone}`, phone, source: "whatsapp" }, null);
    contactId = r.contactId; leadId = r.leadId;
  }
  const { error } = await db.from("messages").insert({
    workspace_id: ws, contact_id: contactId, lead_id: leadId, channel: "whatsapp", direction: "inbound", body: m.body, status: "received", provider_sid: m.sid,
  });
  if (error?.code === "23505") { await event(ws, "inbound", "message", "duplicate", m.sid); return false; }   // raced with the other path
  if (error) throw new Error(error.message);
  await logActivity(ws, null, { contactId, type: "message", text: `Received: ${m.body.slice(0, 140)}` });
  await event(ws, "inbound", "message", "ok", m.sid);
  return true;
}

/** Which workspace the sandbox number belongs to: TWILIO_WORKSPACE_ID, else the newest workspace. */
let wsCache: string | null = null;
async function targetWorkspace() {
  if (process.env.TWILIO_WORKSPACE_ID) return process.env.TWILIO_WORKSPACE_ID;
  if (wsCache) return wsCache;
  const { data } = await supabaseAdmin().from("workspaces").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
  wsCache = data?.id ?? null;
  setTimeout(() => { wsCache = null; }, 60_000);
  return wsCache;
}

/* ---------------- poller (localhost-friendly) ---------------- */

const startedAt = Date.now() - 10 * 60_000;   // don't import old history on first run
export function startTwilioPoller() {
  if (!twilioEnv() || process.env.TWILIO_POLL === "off") return;
  let busy = false;
  console.log("[api] Twilio WhatsApp poller on (every 5 s)");
  setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const ws = await targetWorkspace(); if (!ws) return;
      const list = (await recentMessages()).filter((m) => new Date(m.date_created).getTime() >= startedAt);
      for (const m of list.reverse()) {
        if (m.direction === "inbound") await handleInbound(ws, m);
        else await syncStatus(ws, m);
      }
    } catch (e) { console.error("[api] twilio poll:", (e as Error).message); }
    finally { busy = false; }
  }, 5_000);
}

/** Outbound delivery status from Twilio's log or status callback (I1.4). */
async function syncStatus(ws: string, m: Pick<TwilioMessage, "sid" | "status" | "error_message" | "error_code">) {
  const status = STATUS[m.status] ?? "sent";
  const db = supabaseAdmin();
  const { data } = await db.from("messages").select("id, status").eq("workspace_id", ws).eq("provider_sid", m.sid).maybeSingle();
  if (!data || data.status === status) return;
  await db.from("messages").update({ status, error: status === "failed" ? explain({ code: m.error_code ?? undefined, message: m.error_message ?? undefined }) : null, updated_at: new Date().toISOString() }).eq("id", data.id);
}

/* ---------------- signed webhooks (when deployed with a public URL) ---------------- */

const form = express.urlencoded({ extended: false });
const fullUrl = (req: express.Request) => `${process.env.PUBLIC_API_URL?.replace(/\/$/, "") ?? `${req.protocol}://${req.get("host")}`}${req.originalUrl}`;

messaging.post("/webhooks/twilio/status", form, async (req, res) => {
  const ws = await targetWorkspace();
  if (!validSignature(req.get("X-Twilio-Signature"), fullUrl(req), req.body)) {
    await event(ws, "inbound", "status_callback", "rejected", req.body?.MessageSid ?? null, "Signature check failed");
    return void res.status(403).send("Invalid signature");
  }
  if (ws) await syncStatus(ws, { sid: req.body.MessageSid, status: req.body.MessageStatus, error_code: Number(req.body.ErrorCode) || null, error_message: req.body.ErrorMessage ?? null });
  res.type("text/xml").send("<Response/>");
});

messaging.post("/webhooks/twilio/:workspaceId", form, async (req, res) => {
  const { workspaceId } = parse(z.object({ workspaceId: z.string().uuid() }), req.params);
  if (!validSignature(req.get("X-Twilio-Signature"), fullUrl(req), req.body)) {
    await event(workspaceId, "inbound", "message", "rejected", req.body?.MessageSid ?? null, "Signature check failed; request rejected");
    return void res.status(403).send("Invalid signature");
  }
  await handleInbound(workspaceId, { sid: req.body.MessageSid, from: req.body.From, body: req.body.Body ?? "" });
  res.type("text/xml").send("<Response/>");
});

/* ---------------- sending (I1.3, I1.7, I1.9) ---------------- */

async function canSeeContact(ctx: Ctx, contactId: string) {
  const { data } = await supabaseAdmin().from("contacts").select("id, phone, opted_out, owner_id").eq("id", contactId).eq("workspace_id", ctx.member.workspaceId).maybeSingle();
  if (!data) throw new HttpError(404, "Contact not found.");
  // I1.6: conversations are visible to their owner, or with conversations.view_all
  if (data.owner_id !== ctx.member.id && !can(ctx, "conversations.view_all") && ctx.member.level === "user") throw new HttpError(403, "This conversation belongs to another employee.");
  return data as { id: string; phone: string | null; opted_out: boolean };
}

async function deliver(ctx: Ctx, messageId: string, phone: string, body: string) {
  const db = supabaseAdmin();
  try {
    const t = await sendWhatsApp(phone, body);
    await db.from("messages").update({ status: STATUS[t.status] ?? "queued", provider_sid: t.sid, error: null, updated_at: new Date().toISOString() }).eq("id", messageId);
    await event(ctx.member.workspaceId, "outbound", "message", "ok", t.sid);
  } catch (e) {
    const why = explain(e);
    await db.from("messages").update({ status: "failed", error: why, updated_at: new Date().toISOString() }).eq("id", messageId);   // stays visible (I1.7)
    await event(ctx.member.workspaceId, "outbound", "message", "error", messageId, why);
  }
}

messaging.post("/contacts/:id/messages", ...allow("crm.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  const { body } = parse(z.object({ body: z.string().trim().min(1, "Write a message first.").max(1600) }).strict(), req.body);
  const c = await canSeeContact(ctx, id);
  if (c.opted_out) throw new HttpError(400, "This contact opted out of messaging. Remove the opt-out only if they ask to be contacted again.");
  if (!c.phone) throw new HttpError(400, "This contact has no phone number.");
  if (!twilioEnv()) throw new HttpError(503, "Messaging isn't connected. Add the Twilio credentials to the server.");
  const row = must(await supabaseAdmin().from("messages").insert({
    workspace_id: ctx.member.workspaceId, contact_id: id, channel: "whatsapp", direction: "outbound", body, status: "queued", sent_by: ctx.member.id,
  }).select("id").single()) as { id: string };
  await deliver(ctx, row.id, c.phone, body);
  await logActivity(ctx.member.workspaceId, ctx.member.id, { contactId: id, type: "message", text: `Sent: ${body.slice(0, 140)}` });
  await supabaseAdmin().rpc("api_touch_contact_leads", { p_actor: ctx.member.id, p_ws: ctx.member.workspaceId, p_contact: id });   // a reply acknowledges
  res.status(201).json({ id: row.id });
});

messaging.post("/messages/:id/retry", ...allow("crm.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = parse(Id, req.params);
  const { data: m } = await supabaseAdmin().from("messages").select("id, contact_id, body, status, direction").eq("id", id).eq("workspace_id", ctx.member.workspaceId).maybeSingle();
  if (!m) throw new HttpError(404, "Message not found.");
  if (m.direction !== "outbound" || m.status !== "failed") throw new HttpError(400, "Only failed outgoing messages can be retried.");
  const c = await canSeeContact(ctx, m.contact_id);
  if (c.opted_out) throw new HttpError(400, "This contact opted out of messaging.");
  await supabaseAdmin().from("messages").update({ status: "queued", error: null }).eq("id", id);
  await deliver(ctx, id, c.phone ?? "", m.body);
  res.json({ ok: true });
});
