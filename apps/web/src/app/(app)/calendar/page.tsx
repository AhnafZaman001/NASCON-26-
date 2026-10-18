"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useApp } from "@/lib/app";
import { bookAppointment, cancelAppointment, conflicts, nameOf, rescheduleAppointment } from "@/lib/store";
import { fmtTime } from "@/lib/utils";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, toast, useNow } from "@/components/ui";

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function CalInner() {
  const { s, me, companyWide } = useApp(); const q = useSearchParams(); const nowTs = useNow(30_000);
  const [f, setF] = useState(() => ({ contactId: q.get("contact") ?? "", memberId: me?.id ?? "", title: "", start: toLocalInput(Date.now() + 86400_000), mins: "30" }));
  const [err, setErr] = useState(""); const [warn, setWarn] = useState(false); const [resched, setResched] = useState<{ id: string; start: string } | null>(null);
  if (!me) return null;
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = new Date(f.start).getTime(); const end = start + Number(f.mins) * 60_000;
  const target = s.members.find((m) => m.id === f.memberId); const clash = target && !isNaN(start) ? conflicts(s, target.id, start, end) : [];
  const list = s.appointments.filter((a) => a.status === "confirmed" && a.end > nowTs && (companyWide || a.memberId === me.id)).sort((a, b) => a.start - b.start);
  const book = (force = false) => {
    if (!f.contactId || !f.title.trim() || isNaN(start)) { setErr("Choose a contact, a title and a start time."); return; }
    const r = bookAppointment({ contactId: f.contactId, oppId: q.get("opp"), memberId: f.memberId, title: f.title.trim(), start, end, tz: target?.tz ?? viewerTz }, force);
    if (!r.ok) { setErr(r.error ?? ""); setWarn(r.error?.includes("overlaps") ?? false); return; }
    setErr(""); setWarn(false); setF({ ...f, title: "" }); toast("Booked and added to the employee's Google Calendar.", "ok");
  };
  return (
    <>
      <PageHeader title="Calendar" sub={`Times are stored in UTC. Your timezone: ${viewerTz}.`} />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="space-y-3 lg:col-span-2">
          <h2 className="font-semibold">Book an appointment</h2>
          <Field label="Contact">{(id) => <Select id={id} value={f.contactId} onChange={(e) => setF({ ...f, contactId: e.target.value })}><option value="">Select…</option>{s.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Employee">{(id) => <Select id={id} value={f.memberId} onChange={(e) => { setF({ ...f, memberId: e.target.value }); setErr(""); }}>{s.members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.calendar !== "connected" ? " (no calendar)" : ""}</option>)}</Select>}</Field>
          {target && target.calendar !== "connected" && <p role="alert" className="rounded-lg bg-warn/10 p-2 text-xs text-warn">{target.calendar === "needs_reconnect" ? `${target.name}'s Google connection expired. They need to reconnect it.` : `${target.name} hasn't connected a Google Calendar, so they can't be booked.`}</p>}
          <Field label="Title">{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <div className="grid grid-cols-2 gap-2"><Field label={`Start (${viewerTz})`}>{(id) => <Input id={id} type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />}</Field>
            <Field label="Length">{(id) => <Select id={id} value={f.mins} onChange={(e) => setF({ ...f, mins: e.target.value })}><option value="15">15 min</option><option value="30">30 min</option><option value="60">1 hour</option><option value="90">90 min</option></Select>}</Field></div>
          {target && !isNaN(start) && <p className="text-xs text-muted">For {target.name} ({target.tz}): {fmtTime(start, target.tz)}</p>}
          {clash.length > 0 && <p role="alert" className="rounded-lg bg-warn/10 p-2 text-xs text-warn">Overlaps: {clash.map((a) => `${a.title} (${fmtTime(a.start, target?.tz)})`).join(", ")}</p>}
          {err && !warn && <p role="alert" className="text-xs text-bad">{err}</p>}
          <div className="flex flex-wrap gap-2"><Button onClick={() => book(false)}>Book</Button>{clash.length > 0 && <Button variant="secondary" onClick={() => book(true)}>Book anyway</Button>}</div>
        </Card>
        <div className="space-y-2 lg:col-span-3">
          <h2 className="font-semibold">Upcoming</h2>
          {list.length === 0 ? <Empty title="No upcoming appointments" /> : list.map((a) => {
            const m = s.members.find((x) => x.id === a.memberId);
            return (
              <Card key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-medium">{a.title}</p><p className="text-sm text-muted">{s.contacts.find((c) => c.id === a.contactId)?.name} with {nameOf(s, a.memberId)}</p>
                  <p className="text-xs text-muted">{fmtTime(a.start)} (you) · {fmtTime(a.start, m?.tz)} ({m?.tz})</p></div>
                <div className="flex items-center gap-2">
                  {resched?.id === a.id ? (<><Input aria-label="New start time" type="datetime-local" value={resched.start} onChange={(e) => setResched({ id: a.id, start: e.target.value })} className="!w-48 !py-1 !text-xs" />
                    <Button size="sm" onClick={() => { const st = new Date(resched.start).getTime(); const r = rescheduleAppointment(a.id, st, st + (a.end - a.start)); if (r.ok) { setResched(null); toast("Rescheduled. Google event updated.", "ok"); } else toast(r.error ?? "", "bad"); }}>Save</Button></>)
                    : <Button size="sm" variant="secondary" onClick={() => setResched({ id: a.id, start: toLocalInput(a.start) })}>Reschedule</Button>}
                  <Button size="sm" variant="ghost" onClick={() => { cancelAppointment(a.id); toast("Cancelled.", "ok"); }}>Cancel</Button></div>
              </Card>);
          })}
        </div>
      </div>
      <Card className="mt-4"><h2 className="mb-2 font-semibold">Calendar connections</h2>
        <ul className="grid gap-1.5 text-sm sm:grid-cols-2">{s.members.map((m) => <li key={m.id} className="flex justify-between"><span>{m.name}</span><Badge tone={m.calendar === "connected" ? "ok" : m.calendar === "needs_reconnect" ? "warn" : "neutral"}>{m.calendar === "connected" ? "connected" : m.calendar === "needs_reconnect" ? "needs reconnect" : "not connected"}</Badge></li>)}</ul></Card>
    </>
  );
}
export default function CalendarPage() { return <Suspense fallback={null}><CalInner /></Suspense>; }
