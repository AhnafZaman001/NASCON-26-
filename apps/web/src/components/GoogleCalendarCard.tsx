import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app";
import { connectGoogleCalendar, disconnectGoogleCalendar } from "@/lib/store";
import { ago, fmtTime } from "@/lib/utils";
import { Badge, Button, Card, toast } from "@/components/ui";

type Status = {
  configured: boolean; redirectUri: string | null; myEmail: string | null;
  members: { id: string; name: string; status: string; timezone: string | null }[];
  events: { id: number; direction: string; type: string; status: string; ref: string | null; error: string | null; at: number }[];
};
const tone = (s: string) => (s === "connected" ? "ok" : s === "needs_reconnect" || s === "error" ? "warn" : "neutral") as "ok" | "warn" | "neutral";
const label = (s: string) => (s === "none" || s === "not_connected" ? "not connected" : s.replace("_", " "));

/** Live Google Calendar integration (I3.1, I3.2, I3.7, I5.1, I5.6): each employee connects their own account. */
export default function GoogleCalendarCard({ version = 0 }: { version?: number }) {
  const { s, me, can } = useApp();
  const [st, setSt] = useState<Status | null>(null); const [err, setErr] = useState(""); const [pending, setPending] = useState<string | null>(null);
  const manage = can("integrations.manage");
  const load = useCallback(() => api<Status>("/calendar/status").then((d) => { setSt(d); setErr(""); }).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load, version]);
  if (!me) return null;

  const mine = me.calendar === "none" ? "not_connected" : me.calendar;
  const overall = s.members.some((m) => m.calendar === "connected") ? "connected" : s.members.some((m) => m.calendar === "needs_reconnect") ? "error" : "not_connected";
  const lastOk = st?.events.find((e) => e.status === "ok");
  const errors = st?.events.filter((e) => e.status === "error" || e.status === "rejected").slice(0, 3) ?? [];

  const connect = async () => { setPending("me"); const r = await connectGoogleCalendar(); if (!r.ok) { toast(r.error ?? "", "bad"); setPending(null); } };
  const disconnect = async (id: string, name: string) => {
    setPending(id); const r = await disconnectGoogleCalendar(id === me.id ? undefined : id); setPending(null);
    if (r.ok) { toast(id === me.id ? "Your Google Calendar was disconnected." : `${name}'s Google Calendar was disconnected.`, "info"); void load(); } else toast(r.error ?? "", "bad");
  };

  return (
    <Card className="space-y-3 md:col-span-2">
      <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Calendar <span className="text-sm font-normal text-muted">· Google Calendar (OAuth 2.0)</span></h2><Badge tone={overall === "connected" ? "ok" : overall === "error" ? "bad" : "neutral"}>{label(overall)}</Badge></div>
      <p className="text-sm">Book appointments on employees&apos; real Google Calendars and avoid double-booking. Each employee connects their own account; nobody else can use it.</p>
      <p className="rounded-lg bg-surface2 p-2 text-xs text-muted">While the Google app is in testing status, only listed test users can connect, and refresh tokens may be short-lived (reconnect if the status turns to &quot;needs reconnect&quot;). Tokens are encrypted and stay on the server. Only the calendar&apos;s busy times and events booked here are used.</p>
      {err && <p role="alert" className="text-xs text-bad">{err}</p>}
      {st && !st.configured && <p role="alert" className="rounded-lg bg-warn/10 p-2 text-xs text-warn">{manage ? "The server has no Google credentials yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY to apps/api/.env (see .env.example)." : "Google Calendar isn't set up on the server yet. Ask an admin."}</p>}
      {manage && st?.redirectUri && <p className="text-xs text-muted">Redirect URI to register in Google Cloud: <code className="rounded bg-surface2 px-1 py-0.5">{st.redirectUri}</code></p>}
      <p className="text-xs text-muted">Last worked: {lastOk ? ago(lastOk.at) : manage ? "never" : "—"}</p>
      {errors.length > 0 && <ul className="space-y-1">{errors.map((e) => <li key={e.id} className="text-xs text-bad">{ago(e.at)}: {e.error}</li>)}</ul>}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3">
        <div className="text-sm"><p className="font-medium">Your calendar <Badge tone={tone(mine)}>{label(mine)}</Badge></p>
          {mine === "connected" && st?.myEmail && <p className="text-xs text-muted">{st.myEmail}</p>}
          {mine === "needs_reconnect" && <p className="text-xs text-warn">Google revoked or expired this connection. Reconnect to be bookable again.</p>}
          {mine === "not_connected" && <p className="text-xs text-muted">Not connected: others can&apos;t book you.</p>}</div>
        <div className="flex gap-2">
          {mine !== "connected" && <Button size="sm" onClick={() => void connect()} disabled={pending === "me" || st?.configured === false}>{pending === "me" ? "Opening Google…" : mine === "needs_reconnect" ? "Reconnect Google" : "Connect Google Calendar"}</Button>}
          {mine !== "not_connected" && <Button size="sm" variant="secondary" onClick={() => void disconnect(me.id, me.name)} disabled={pending === me.id}>Disconnect</Button>}</div>
      </div>

      {manage && st && (<div><h3 className="mb-1 text-sm font-semibold">Employee connections</h3>
        <ul className="divide-y divide-line text-sm">{st.members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span>{m.name}{m.timezone && <span className="ml-2 text-xs text-muted">{m.timezone}</span>}</span>
            <span className="flex items-center gap-2"><Badge tone={tone(m.status)}>{label(m.status)}</Badge>
              {m.id !== me.id && m.status !== "not_connected" && <Button size="sm" variant="ghost" disabled={pending === m.id} onClick={() => void disconnect(m.id, m.name)}>Disconnect</Button>}
              {m.id !== me.id && m.status !== "connected" && <span className="text-xs text-muted">They connect their own account</span>}</span></li>))}</ul></div>)}

      {manage && st && st.events.length > 0 && (<div><h3 className="mb-1 text-sm font-semibold">Recent calendar activity</h3>
        <ul className="divide-y divide-line text-sm">{st.events.slice(0, 8).map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5"><span className="w-36 text-xs text-muted">{fmtTime(e.at)}</span><Badge tone="neutral">{e.direction === "in" || e.direction === "inbound" ? "inbound" : "outbound"}</Badge>
            <span className="min-w-0 flex-1">{e.type.replace(/_/g, " ")}{e.error ? ` — ${e.error}` : ""}</span><Badge tone={e.status === "ok" ? "ok" : "bad"}>{e.status}</Badge></li>))}</ul></div>)}
    </Card>
  );
}
