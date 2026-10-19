import { Link, useSearchParams } from "react-router-dom";
import { Suspense, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useApp } from "@/lib/app";
import { bookAppt, cancelAppt, conflicts as localConflicts, fetchBusy, moveAppt, nameOf, syncAppointments, type CalConflict } from "@/lib/store";
import { fmtTime } from "@/lib/utils";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, toast, useNow } from "@/components/ui";

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function CalInner() {
  const { s, me, companyWide } = useApp(); const [q] = useSearchParams(); const nowTs = useNow(30_000);
  const live = s.mode === "live";
  const [f, setF] = useState(() => ({ contactId: q.get("contact") ?? "", memberId: me?.id ?? "", title: "", start: toLocalInput(Date.now() + 86400_000), mins: "30" }));
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [resched, setResched] = useState<{ id: string; start: string; err?: string; clash?: boolean } | null>(null);
  const [liveClash, setLiveClash] = useState<{ key: string; list: CalConflict[]; error?: string } | null>(null);
  const [serverClash, setServerClash] = useState<CalConflict[]>([]);

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = new Date(f.start).getTime(); const end = start + Number(f.mins) * 60_000;
  const target = s.members.find((m) => m.id === f.memberId);
  const canBook = !!target && target.calendar === "connected";
  const key = `${f.memberId}|${start}|${end}`;

  // Live mode: ask the server (Google free/busy + platform appointments) whenever the slot changes (I3.4).
  useEffect(() => {
    if (!live || !canBook || isNaN(start)) return;
    let stale = false;
    const t = setTimeout(() => {
      fetchBusy(f.memberId, start, end).then((list) => { if (!stale) setLiveClash({ key, list }); })
        .catch((e: Error) => { if (!stale) setLiveClash({ key, list: [], error: e.message }); });
    }, 500);
    return () => { stale = true; clearTimeout(t); };
  }, [live, canBook, key, f.memberId, start, end]);
  useEffect(() => { if (live) void syncAppointments(); }, [live]);

  if (!me) return null;
  const clash: CalConflict[] = live
    ? (liveClash?.key === key ? liveClash.list : [])
    : (target && !isNaN(start) ? localConflicts(s, target.id, start, end) : []).map((a) => ({ source: "platform" as const, title: a.title, start: new Date(a.start).toISOString(), end: new Date(a.end).toISOString() }));
  const checking = live && canBook && !isNaN(start) && liveClash?.key !== key;
  const shown = serverClash.length ? serverClash : clash;
  const list = s.appointments.filter((a) => a.status === "confirmed" && a.end > nowTs && (companyWide || a.memberId === me.id)).sort((a, b) => a.start - b.start);

  const book = async (force = false) => {
    if (!f.contactId || !f.title.trim() || isNaN(start)) { setErr("Choose a contact, a title and a start time."); return; }
    setBusy(true); setErr("");
    const r = await bookAppt({ contactId: f.contactId, oppId: q.get("opp"), memberId: f.memberId, title: f.title.trim(), start, end, tz: target?.tz ?? viewerTz }, force);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? ""); setServerClash(r.conflicts ?? (r.error?.includes("overlaps") ? clash : [])); return; }
    setServerClash([]); setLiveClash(null); setF({ ...f, title: "" });
    toast(live ? "Booked and added to the employee's Google Calendar." : "Booked and added to the employee's Google Calendar (demo).", "ok");
  };
  const overlapErr = shown.length > 0 && !!err;

  return (
    <>
      <PageHeader title="Calendar" sub={`Times are stored in UTC. Your timezone: ${viewerTz}.`} />
      {live && me.calendar !== "connected" && (
        <p role="status" className="mb-4 rounded-lg bg-warn/10 p-3 text-sm text-warn">
          {me.calendar === "needs_reconnect" ? "Your Google connection expired." : "Your Google Calendar isn't connected."} Others can't book you until you <Link to="/integrations" className="font-medium underline">connect it on the Integrations page</Link>.
        </p>)}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="space-y-3 lg:col-span-2">
          <h2 className="font-semibold">Book an appointment</h2>
          <Field label="Contact">{(id) => <Select id={id} value={f.contactId} onChange={(e) => setF({ ...f, contactId: e.target.value })}><option value="">Select…</option>{s.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Employee">{(id) => <Select id={id} value={f.memberId} onChange={(e) => { setF({ ...f, memberId: e.target.value }); setErr(""); setServerClash([]); }}>{s.members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.calendar !== "connected" ? " (no calendar)" : ""}</option>)}</Select>}</Field>
          {target && target.calendar !== "connected" && <p role="alert" className="rounded-lg bg-warn/10 p-2 text-xs text-warn">{target.calendar === "needs_reconnect" ? `${target.name}'s Google connection expired. They need to reconnect it.` : `${target.name} hasn't connected a Google Calendar, so they can't be booked.`}</p>}
          <Field label="Title">{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <div className="grid grid-cols-2 gap-2"><Field label={`Start (${viewerTz})`}>{(id) => <Input id={id} type="datetime-local" value={f.start} onChange={(e) => { setF({ ...f, start: e.target.value }); setServerClash([]); setErr(""); }} />}</Field>
            <Field label="Length">{(id) => <Select id={id} value={f.mins} onChange={(e) => { setF({ ...f, mins: e.target.value }); setServerClash([]); setErr(""); }}><option value="15">15 min</option><option value="30">30 min</option><option value="60">1 hour</option><option value="90">90 min</option></Select>}</Field></div>
          {target && !isNaN(start) && <p className="text-xs text-muted">For {target.name} ({target.tz}): {fmtTime(start, target.tz)}</p>}
          {checking && <p role="status" className="text-xs text-muted">Checking {target?.name}'s Google Calendar…</p>}
          {live && liveClash?.key === key && liveClash.error && <p role="alert" className="rounded-lg bg-warn/10 p-2 text-xs text-warn">Couldn't check Google busy times: {liveClash.error}</p>}
          {shown.length > 0 && <div role="alert" className="rounded-lg bg-warn/10 p-2 text-xs text-warn">Overlaps:
            <ul className="mt-1 list-disc pl-4">{shown.map((a, i) => <li key={i}>{a.title} ({fmtTime(new Date(a.start).getTime(), target?.tz)} – {fmtTime(new Date(a.end).getTime(), target?.tz)}) <span className="text-muted">· {a.source === "google" ? "Google Calendar" : "booked here"}</span></li>)}</ul></div>}
          {err && !overlapErr && <p role="alert" className="text-xs text-bad">{err}</p>}
          <div className="flex flex-wrap gap-2"><Button onClick={() => void book(false)} disabled={busy || checking || (live && !canBook)}>{busy ? "Booking…" : "Book"}</Button>{shown.length > 0 && <Button variant="secondary" disabled={busy} onClick={() => void book(true)}>Book anyway</Button>}</div>
        </Card>
        <div className="space-y-2 lg:col-span-3">
          <h2 className="font-semibold">Upcoming</h2>
          {list.length === 0 ? <Empty title="No upcoming appointments" /> : list.map((a) => {
            const m = s.members.find((x) => x.id === a.memberId);
            return (
              <Card key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-medium">{a.title}</p><p className="text-sm text-muted">{s.contacts.find((c) => c.id === a.contactId)?.name} with {nameOf(s, a.memberId)}</p>
                  <p className="text-xs text-muted">{fmtTime(a.start)} (you) · {fmtTime(a.start, m?.tz)} ({m?.tz})</p>
                  {a.link && <a href={a.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand underline">Open in Google Calendar<ExternalLink size={12} aria-hidden /></a>}
                  {resched?.id === a.id && resched.err && <p role="alert" className="mt-1 text-xs text-bad">{resched.err}</p>}</div>
                <div className="flex items-center gap-2">
                  {resched?.id === a.id ? (<><Input aria-label="New start time" type="datetime-local" value={resched.start} onChange={(e) => setResched({ id: a.id, start: e.target.value })} className="!w-48 !py-1 !text-xs" />
                    <Button size="sm" onClick={async () => {
                      const st = new Date(resched.start).getTime(); if (isNaN(st)) return;
                      const r = await moveAppt(a.id, st, st + (a.end - a.start), resched.clash);
                      if (r.ok) { setResched(null); toast(live ? "Rescheduled. Google event updated." : "Rescheduled (demo).", "ok"); }
                      else setResched({ ...resched, err: r.error ?? "Couldn't reschedule.", clash: !!r.conflicts?.length || !!r.error?.includes("overlap") });
                    }}>{resched.clash ? "Move anyway" : "Save"}</Button></>)
                    : <Button size="sm" variant="secondary" onClick={() => setResched({ id: a.id, start: toLocalInput(a.start) })}>Reschedule</Button>}
                  <Button size="sm" variant="ghost" onClick={async () => { const r = await cancelAppt(a.id); if (!r.ok) toast(r.error ?? "Couldn't cancel.", "bad"); else toast(r.warning ?? "Cancelled.", r.warning ? "info" : "ok"); }}>Cancel</Button></div>
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
