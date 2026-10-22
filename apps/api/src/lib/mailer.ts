import nodemailer, { type Transporter } from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase.ts";

// I4: sends the rows that migration 0020 queues in `emails` (one per assignment / escalation).
// No Redis: this runs inside the API, triggered by pg_cron + pg_net (POST /api/jobs/send-emails),
// by a timer when the API runs as a long-lived server, or by an admin pressing "Send now".

type Row = {
  id: string; workspace_id: string; from_email: string | null; to_email: string;
  cc: string[]; bcc: string[]; subject: string; body_text: string | null; body_html: string | null;
  attempts: number; max_attempts: number;
};
export type DrainResult = { claimed: number; sent: number; retrying: number; failed: number; skipped?: string };

export const smtpConfigured = () => Boolean(process.env.SMTP_HOST);

let cached: Transporter | null = null;
function transport(): Transporter {
  cached ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: (process.env.SMTP_SECURE ?? "true") === "true",
    auth: process.env.SMTP_USER && process.env.SMTP_PASS ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  return cached;
}

/** Base URL used for the "Open the lead" link in alerts. */
export function webUrl(): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const u = process.env.WEB_URL ?? (prod ? `https://${prod}` : undefined) ?? process.env.CORS_ORIGIN?.split(",")[0] ?? "http://localhost:5173";
  return u.replace(/\/+$/, "");
}
const fill = (s: string | null) => (s === null ? undefined : s.replaceAll("{{WEB_URL}}", webUrl()));

async function logEvent(db: SupabaseClient, r: Row, status: "ok" | "error", error: string | null) {
  // Synchronization history (I5.4). external_id carries the attempt so a retry never collides with its failure row.
  try {
    await db.from("integration_events").insert({
      workspace_id: r.workspace_id, provider: "email", direction: "outbound", event_type: "email.send",
      external_id: `${r.id}:${r.attempts}`, status, reference: r.to_email, error,
    });
  } catch { /* history must never break sending */ }
}

/** Claim due emails and send them. Failures are retried with a growing delay up to max_attempts (I4.4). */
export async function drainEmails(
  limit = 20,
  deps: { db?: SupabaseClient; mail?: Pick<Transporter, "sendMail"> } = {},
): Promise<DrainResult> {
  const out: DrainResult = { claimed: 0, sent: 0, retrying: 0, failed: 0 };
  if (!smtpConfigured()) return { ...out, skipped: "SMTP is not configured (SMTP_HOST missing)" };
  const db = deps.db ?? supabaseAdmin();
  const mail = deps.mail ?? transport();

  const { data, error } = await db.rpc("claim_due_emails", { p_limit: limit });
  if (error) throw new Error(`claim_due_emails: ${error.message}`);
  const rows = (data ?? []) as Row[];
  out.claimed = rows.length;

  for (const r of rows) {
    try {
      const info = await mail.sendMail({
        from: r.from_email ?? process.env.MAIL_FROM ?? process.env.SMTP_USER,
        to: r.to_email,
        cc: r.cc.length ? r.cc : undefined,
        bcc: r.bcc.length ? r.bcc : undefined,
        subject: r.subject,
        text: fill(r.body_text),
        html: fill(r.body_html),
      });
      await db.from("emails").update({ status: "sent", sent_at: new Date().toISOString(), message_id: info.messageId, last_error: null }).eq("id", r.id);
      await logEvent(db, r, "ok", null);
      out.sent++;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      const final = r.attempts >= r.max_attempts;
      await db.from("emails").update(
        final ? { status: "failed", last_error: msg }
              : { status: "pending", last_error: msg, scheduled_at: new Date(Date.now() + r.attempts * 30_000).toISOString() },
      ).eq("id", r.id);
      await logEvent(db, r, "error", msg);
      if (final) out.failed++; else out.retrying++;
    }
  }
  return out;
}
