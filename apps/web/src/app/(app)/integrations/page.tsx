"use client";
import { useState } from "react";
import { useApp } from "@/lib/app";
import { connectIntegration, disconnectIntegration, providerOptions, setFailNext, setMemberCalendar, setMyNotifyDest } from "@/lib/store";
import { ago, fmtTime } from "@/lib/utils";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, toast } from "@/components/ui";
import type { IntegrationKey } from "@/lib/types";

const INFO: Record<IntegrationKey, { title: string; does: string; limits: string }> = {
  messaging: { title: "Messaging", does: "Receive customer messages as leads, reply from the platform, and track delivery.", limits: "The WhatsApp sandbox only reaches phones that have joined it by sending the join phrase. Sandbox messages are for testing only." },
  payments: { title: "Payments", does: "Create checkout links from opportunities and update status from verified webhooks.", limits: "Test mode only: use Stripe's published test cards. Card details are entered on Stripe's hosted page, never here." },
  calendar: { title: "Calendar", does: "Book appointments on employees' real Google Calendars and avoid double-booking.", limits: "While the Google app is in testing status, only listed test users can connect, and refresh tokens may be short-lived." },
  notifications: { title: "Notifications", does: "Alert the new owner outside the app when a lead escalates.", limits: "Slack, Telegram and email each have their own rate limits. Failed alerts are retried a limited number of times." },
};
const tone = { connected: "ok", error: "bad", not_connected: "neutral" } as const;

export default function Integrations() {
  const { s, me, can } = useApp(); const [prov, setProv] = useState<Record<string, string>>({});
  if (!me) return null;
  const manage = can("integrations.manage");
  return (
    <>
      <PageHeader title="Integrations" sub={`Credentials are held by the server for ${s.workspace.name} only. Secrets never reach the browser.`} />
      <div className="grid gap-4 md:grid-cols-2">
        {(Object.keys(INFO) as IntegrationKey[]).map((k) => {
          const i = s.integrations[k];
          return (
            <Card key={k} className="space-y-3">
              <div className="flex items-center justify-between"><h2 className="font-semibold">{INFO[k].title} <span className="text-sm font-normal text-muted">· {i.provider}</span></h2><Badge tone={tone[i.status]}>{i.status.replace("_", " ")}</Badge></div>
              <p className="text-sm">{INFO[k].does}</p><p className="rounded-lg bg-surface2 p-2 text-xs text-muted">{INFO[k].limits}</p>
              <p className="text-xs text-muted">Last worked: {i.lastOk ? ago(i.lastOk) : "never"}</p>
              {i.errors.length > 0 && <ul className="space-y-1">{i.errors.slice(0, 3).map((e, j) => <li key={j} className="text-xs text-bad">{ago(e.at)}: {e.text}</li>)}</ul>}
              {k === "notifications" && manage && i.status !== "connected" && <Select aria-label="Notification provider" value={prov[k] ?? i.provider} onChange={(e) => setProv({ ...prov, [k]: e.target.value })}>{providerOptions(k).map((p) => <option key={p}>{p}</option>)}</Select>}
              {manage ? (<div className="flex flex-wrap gap-2">
                {i.status === "connected" ? <Button variant="secondary" size="sm" onClick={() => { disconnectIntegration(k); toast(`${INFO[k].title} disconnected.`, "info"); }}>Disconnect</Button>
                  : <Button size="sm" onClick={() => { connectIntegration(k, prov[k]); toast(`${INFO[k].title} connected.`, "ok"); }}>{i.status === "error" ? "Reconnect" : "Connect"}</Button>}
                {k === "messaging" && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!i.failNext} onChange={(e) => setFailNext(e.target.checked)} className="accent-[var(--brand)]" />Fail the next send (demo)</label>}
              </div>) : <p className="text-xs text-muted">You need the &quot;manage integrations&quot; permission to change this.</p>}
            </Card>);
        })}
      </div>
      <Card className="mt-4"><h2 className="mb-2 font-semibold">My alert destination</h2>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get("dest") as string; setMyNotifyDest(v.trim()); toast("Saved.", "ok"); }}>
          <Field label="Slack user / Telegram chat / email" hint="Where you're alerted when a lead escalates to you.">{(id) => <Input id={id} name="dest" defaultValue={me.notifyDest} />}</Field><Button type="submit">Save</Button></form></Card>
      {manage && <Card className="mt-4"><h2 className="mb-2 font-semibold">Employee calendar connections</h2>
        <ul className="space-y-1.5 text-sm">{s.members.map((m) => <li key={m.id} className="flex items-center justify-between gap-2"><span>{m.name}</span><span className="flex items-center gap-2"><Badge tone={m.calendar === "connected" ? "ok" : "warn"}>{m.calendar.replace("_", " ")}</Badge>
          {m.calendar !== "connected" ? <Button size="sm" variant="secondary" onClick={() => setMemberCalendar(m.id, "connected")}>Mark connected (demo)</Button> : <Button size="sm" variant="ghost" onClick={() => setMemberCalendar(m.id, "none")}>Disconnect</Button>}</span></li>)}</ul></Card>}
      <Card className="mt-4"><h2 className="mb-2 font-semibold">Synchronization history</h2>
        {s.sync.length === 0 ? <Empty title="No integration events yet" hint="Inbound webhooks and outbound calls are listed here." /> : (
          <ul className="divide-y divide-line text-sm">{s.sync.slice(0, 25).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 py-2"><span className="w-36 text-xs text-muted">{fmtTime(e.at)}</span><Badge>{e.integration}</Badge><Badge tone="neutral">{e.dir === "in" ? "inbound" : "outbound"}</Badge>
              <Badge tone={e.result === "ok" ? "ok" : e.result === "duplicate" ? "warn" : "bad"}>{e.result}</Badge><span className="min-w-0 flex-1">{e.note}</span><span className="font-mono text-xs text-muted">{e.ref}</span></li>))}</ul>)}</Card>
    </>
  );
}
