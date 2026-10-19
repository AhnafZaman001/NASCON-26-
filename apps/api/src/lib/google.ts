// Google Calendar (I3) over plain REST, like twilio.ts: no SDK. Configuration (apps/api/.env):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   OAuth "Web application" client from Google Cloud Console
//   GOOGLE_REDIRECT_URI                      must be registered on that client; default: <PUBLIC_API_URL>/api/calendar/callback
//   TOKEN_ENCRYPTION_KEY                     see lib/secrets.ts
//   WEB_URL                                  where the browser is sent after consent (default http://localhost:5173)
import { supabaseAdmin } from "./supabase.ts";
import { HttpError } from "./http.ts";
import { decrypt, encrypt } from "./secrets.ts";

export const SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/calendar.events",     // create / change / delete events
  "https://www.googleapis.com/auth/calendar.readonly",   // free/busy and the calendar's time zone
];

export const googleEnv = () => {
  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) return null;
  const base = (process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/$/, "");
  return { id, secret, redirect: process.env.GOOGLE_REDIRECT_URI ?? `${base}/api/calendar/callback` };
};
export const webUrl = () => (process.env.WEB_URL ?? process.env.CORS_ORIGIN?.split(",")[0] ?? "http://localhost:5173").replace(/\/$/, "");

/** kind drives what the caller does: auth = connection is dead, temporary = retry, conflict/gone = idempotency cases. */
export class GoogleError extends Error {
  constructor(public kind: "auth" | "temporary" | "conflict" | "gone" | "permanent", message: string, public status = 0) { super(message); }
}

function classify(status: number, body: { error?: string | { message?: string; errors?: { reason?: string }[] }; error_description?: string }): GoogleError {
  const code = typeof body.error === "string" ? body.error : undefined;
  const msg = (typeof body.error === "object" ? body.error?.message : undefined) ?? body.error_description ?? code ?? `Google returned ${status}`;
  const reason = typeof body.error === "object" ? body.error?.errors?.[0]?.reason : undefined;
  if (code === "invalid_grant" || status === 401) return new GoogleError("auth", msg, status);
  if (status === 409) return new GoogleError("conflict", msg, status);
  if (status === 404 || status === 410) return new GoogleError("gone", msg, status);
  if (status === 429 || status >= 500 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") return new GoogleError("temporary", msg, status);
  return new GoogleError("permanent", msg, status);
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }); }
  catch { throw new GoogleError("temporary", "Google couldn't be reached."); }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw classify(res.status, json);
  return json as T;
}

/** I5.5: temporary errors are retried with a growing delay; everything else surfaces immediately. */
export async function retrying<T>(fn: () => Promise<T>, delays = [400, 1200]): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (!(e instanceof GoogleError) || e.kind !== "temporary" || i >= delays.length) throw e;
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}

/* ---------------- OAuth 2.0 (I3.1) ---------------- */
export function authUrl(state: string, loginHint?: string) {
  const env = googleEnv(); if (!env) throw new HttpError(503, "Google Calendar isn't configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  const p = new URLSearchParams({
    client_id: env.id, redirect_uri: env.redirect, response_type: "code", scope: SCOPES.join(" "), state,
    access_type: "offline",     // we need a refresh token
    prompt: "consent",          // and Google only issues one on a fresh consent
    include_granted_scopes: "true",
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string };
const tokenCall = (form: Record<string, string>) => {
  const env = googleEnv()!;
  return request<TokenResponse>("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.id, client_secret: env.secret, ...form }),
  });
};
export const exchangeCode = (code: string) => tokenCall({ grant_type: "authorization_code", code, redirect_uri: googleEnv()!.redirect });
export const refreshAccess = (refreshToken: string) => tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken });
export const revokeToken = (token: string) =>
  request<void>(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } });

/** The Google account's email from the id_token (already verified by Google over TLS during the code exchange). */
export function emailFromIdToken(idToken?: string): string | null {
  try { return idToken ? (JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")).email ?? null) : null; } catch { return null; }
}

/* ---------------- stored connection (tokens live server-side only, I3.2) ---------------- */
type Stored = { refresh_token: string; access_token: string; expires_at: number; email: string | null };
const PROVIDER = "google_calendar";

export async function saveConnection(ws: string, memberId: string, t: Stored) {
  const { error } = await supabaseAdmin().from("integration_secrets").upsert(
    { workspace_id: ws, provider: PROVIDER, member_id: memberId, ciphertext: encrypt(JSON.stringify(t)), updated_at: new Date().toISOString() },
    { onConflict: "workspace_id,provider,member_id" });
  if (error) throw new HttpError(500, "Couldn't store the Google connection. Please try again.");
}
export async function loadConnection(ws: string, memberId: string): Promise<Stored | null> {
  const { data } = await supabaseAdmin().from("integration_secrets").select("ciphertext").eq("workspace_id", ws).eq("provider", PROVIDER).eq("member_id", memberId).maybeSingle();
  if (!data) return null;
  try { return JSON.parse(decrypt(data.ciphertext)) as Stored; } catch { return null; }
}
export const deleteConnection = async (ws: string, memberId: string) => {
  await supabaseAdmin().from("integration_secrets").delete().eq("workspace_id", ws).eq("provider", PROVIDER).eq("member_id", memberId);
};

/** Flag the connection as dead so the UI asks the employee to reconnect (I3.2). */
export async function markNeedsReconnect(ws: string, memberId: string) {
  await supabaseAdmin().rpc("api_calendar_set_status", { p_actor: null, p_ws: ws, p_member: memberId, p_status: "needs_reconnect", p_tz: null });
}

/** A valid access token for this employee: refreshed when it is about to expire; reconnect flagged when Google says the grant is gone. */
export async function accessToken(ws: string, memberId: string): Promise<string> {
  const c = await loadConnection(ws, memberId);
  if (!c) throw new HttpError(409, "This employee hasn't connected a Google Calendar.");
  if (c.expires_at - Date.now() > 60_000) return c.access_token;
  try {
    const r = await retrying(() => refreshAccess(c.refresh_token));
    await saveConnection(ws, memberId, { ...c, access_token: r.access_token, expires_at: Date.now() + r.expires_in * 1000, refresh_token: r.refresh_token ?? c.refresh_token });
    return r.access_token;
  } catch (e) {
    if (e instanceof GoogleError && e.kind === "auth") {
      await markNeedsReconnect(ws, memberId);
      throw new HttpError(409, "The Google connection was revoked or expired. The employee needs to reconnect their calendar.");
    }
    throw e;
  }
}

/* ---------------- Calendar API ---------------- */
const CAL = "https://www.googleapis.com/calendar/v3";
const call = <T>(token: string, path: string, init: { method?: string; body?: unknown } = {}) =>
  request<T>(`${CAL}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

export const primaryTimezone = (token: string) => retrying(() => call<{ timeZone?: string }>(token, "/calendars/primary")).then((r) => r.timeZone ?? null);

export type Busy = { start: string; end: string };
/** I3.4: the employee's busy times from Google, UTC ISO strings. */
export const freeBusy = (token: string, from: Date, to: Date) =>
  retrying(() => call<{ calendars: Record<string, { busy?: Busy[]; errors?: unknown[] }> }>(token, "/freeBusy", {
    method: "POST", body: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] },
  })).then((r) => r.calendars.primary?.busy ?? []);

export type EventInput = { summary: string; description?: string; start: Date; end: Date; timeZone: string; appointmentId: string; workspaceId: string };
const body = (e: EventInput) => ({
  summary: e.summary, description: e.description,
  // dateTime is an absolute instant (UTC); timeZone only controls how Google displays it (I3.5)
  start: { dateTime: e.start.toISOString(), timeZone: e.timeZone }, end: { dateTime: e.end.toISOString(), timeZone: e.timeZone },
  extendedProperties: { private: { appointmentId: e.appointmentId, workspaceId: e.workspaceId } },
});

/** Google event ids are base32hex; a UUID without dashes qualifies, which makes creation idempotent: a retry gets 409 instead of a duplicate. */
export const eventIdFor = (appointmentId: string) => appointmentId.replace(/-/g, "");

export async function insertEvent(token: string, e: EventInput) {
  const id = eventIdFor(e.appointmentId);
  try {
    return await retrying(() => call<{ id: string; htmlLink?: string }>(token, "/calendars/primary/events?sendUpdates=none", { method: "POST", body: { id, ...body(e) } }));
  } catch (err) {
    if (err instanceof GoogleError && err.kind === "conflict") return call<{ id: string; htmlLink?: string }>(token, `/calendars/primary/events/${id}`);   // already created by an earlier attempt
    throw err;
  }
}
export const patchEvent = (token: string, eventId: string, e: EventInput) =>
  retrying(() => call<{ id: string; htmlLink?: string }>(token, `/calendars/primary/events/${eventId}?sendUpdates=none`, { method: "PATCH", body: body(e) }));
export const deleteEvent = (token: string, eventId: string) =>
  retrying(() => call<void>(token, `/calendars/primary/events/${eventId}?sendUpdates=none`, { method: "DELETE" })).catch((e) => {
    if (e instanceof GoogleError && e.kind === "gone") return;   // already deleted in Google: that's the state we want
    throw e;
  });

/** Plain-language text for a Google failure (I5.5). */
export function explainGoogle(e: unknown) {
  if (e instanceof HttpError) return e.message;
  if (e instanceof GoogleError) {
    if (e.kind === "auth") return "Google rejected the connection. The employee needs to reconnect their calendar.";
    if (e.kind === "temporary") return "Google Calendar is temporarily unavailable. Nothing was lost; try again in a moment.";
    if (e.kind === "gone") return "That event no longer exists in Google Calendar.";
    return `Google Calendar refused the request: ${e.message}`;
  }
  return "Something went wrong talking to Google Calendar.";
}
