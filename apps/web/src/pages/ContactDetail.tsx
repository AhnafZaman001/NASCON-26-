import { Link, useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { Ban, CalendarPlus, CreditCard, Trash2 } from "lucide-react";
import { useApp, canSeeContact, mask } from "@/lib/app";
import { acknowledge, addNote, addTag, deleteContact, moveOpp, nameOf, removeTag, retryMessage, sendMessage, setContactCustom, setOppCustom, setOptOut, setOppValue } from "@/lib/store";
import { ago, fmtTime, money } from "@/lib/utils";
import { Badge, Button, Card, Countdown, Empty, Field, Input, Select, Textarea, toast, useNow } from "@/components/ui";
import type { CustomField } from "@/lib/types";
import RequestPayment from "@/components/RequestPayment";

function CustomInput({ f, value, onChange, disabled }: { f: CustomField; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Field label={f.name}>{(id) => f.type === "dropdown" ? <Select id={id} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{f.options?.map((o) => <option key={o}>{o}</option>)}</Select>
      : f.type === "checkbox" ? <input id={id} type="checkbox" disabled={disabled} checked={value === "true"} onChange={(e) => onChange(String(e.target.checked))} className="size-5 accent-[var(--brand)]" />
      : <Input id={id} disabled={disabled} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} defaultValue={value} onBlur={(e) => e.target.value !== value && onChange(e.target.value)} />}</Field>
  );
}

export default function ContactPage() {
  const { id } = useParams<{ id: string }>(); const router = useNavigate(); const { s, me, can } = useApp(); useNow(1000);
  const [note, setNote] = useState(""); const [msg, setMsg] = useState(""); const [tag, setTag] = useState(""); const [pay, setPay] = useState<string | null>(null);
  const c = s.contacts.find((x) => x.id === id);
  if (!c || !me) return <Empty title="Contact not found" hint="It may have been deleted." />;
  if (!canSeeContact(s, me.id, can("crm.view"), c.id)) return <Empty title="You don't have access to this contact" hint="Ask a manager for CRM view permission." />;
  const edit = can("crm.edit"); const seeVal = can("values.view");
  const lead = s.leads.find((l) => l.contactId === c.id);
  const opps = s.opps.filter((o) => o.contactId === c.id);
  const msgs = s.messages.filter((m) => m.contactId === c.id).sort((a, b) => a.at - b.at);
  const pays = s.payments.filter((p) => p.contactId === c.id); const appts = s.appointments.filter((a) => a.contactId === c.id);
  const acts = s.activity.filter((a) => a.contactId === c.id).sort((a, b) => b.at - a.at);
  const cFields = s.fields.filter((f) => f.entity === "contact");
  const send = (e: React.FormEvent) => { e.preventDefault(); const r = sendMessage(c.id, msg); if (!r.ok && r.error) toast(r.error, "bad"); else setMsg(""); };
  const statusTone = { queued: "neutral", sent: "brand", delivered: "ok", failed: "bad", received: "neutral" } as const;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold sm:text-2xl">{c.name}</h1>
          <p className="text-sm text-muted">{c.phone} · {c.email || "no email"} · {s.companies.find((x) => x.id === c.companyId)?.name ?? "No company"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">{c.tags.map((t) => <Badge key={t}>{t}{edit && <button aria-label={`Remove tag ${t}`} className="ml-1" onClick={() => removeTag(c.id, t)}>×</button>}</Badge>)}
            {edit && <form onSubmit={(e) => { e.preventDefault(); addTag(c.id, tag.trim()); setTag(""); }} className="flex gap-1"><Input aria-label="Add tag" placeholder="Add tag" value={tag} onChange={(e) => setTag(e.target.value)} className="!w-28 !py-1 !text-xs" /></form>}</div></div>
        <div className="flex flex-wrap gap-2">
          {edit && <Button variant="secondary" size="sm" onClick={() => setOptOut(c.id, !c.optedOut)}><Ban size={14} />{c.optedOut ? "Remove opt-out" : "Mark opted out"}</Button>}
          {can("crm.delete") && <Button variant="danger" size="sm" onClick={() => { if (confirm(`Delete ${c.name} and all related records?`)) { deleteContact(c.id); router("/contacts", { replace: true }); } }}><Trash2 size={14} />Delete</Button>}
        </div>
      </div>

      {lead && (
        <Card className="mb-4 border-brand/50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-sm font-semibold">Lead · {lead.source}</p>
              <p className="text-sm text-muted">Accountable owner: <strong className="text-fg">{lead.ownerId ? nameOf(s, lead.ownerId) : "nobody yet"}</strong>{lead.level > 0 && ` · escalation level ${lead.level + 1}`}</p></div>
            <div className="flex items-center gap-2">
              {lead.status === "assigned" && lead.deadlineAt && <Countdown deadline={lead.deadlineAt} />}
              {lead.status === "acknowledged" && <Badge tone="ok">Acknowledged</Badge>}{lead.status === "unassigned" && <Badge tone="bad">Unassigned</Badge>}
              {lead.status === "assigned" && lead.ownerId === me.id && <Button size="sm" onClick={() => { acknowledge(lead.id); toast("Acknowledged.", "ok"); }}>Acknowledge</Button>}
            </div>
          </div>
          {lead.history.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted">Ownership trail ({lead.history.length})</summary>
            <ol className="mt-2 space-y-1">{lead.history.map((h, i) => <li key={i} className="text-muted"><span className="text-fg">{fmtTime(h.at)}</span> · {h.kind}: {nameOf(s, h.from)} → {nameOf(s, h.to)} <span>({h.reason})</span></li>)}</ol></details>}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <h2 className="mb-3 font-semibold">Opportunities</h2>
            {opps.length === 0 ? <p className="text-sm text-muted">None yet. Create one from the Pipeline page.</p> : (
              <ul className="space-y-4">{opps.map((o) => {
                const p = s.pipelines.find((x) => x.id === o.pipelineId); const fields = s.fields.filter((f) => f.entity === "opportunity" && f.pipelineId === o.pipelineId);
                return (
                  <li key={o.id} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{o.title}</p><p className="text-xs text-muted">{p?.name} · owner {nameOf(s, o.ownerId)}</p></div>
                      {seeVal && edit ? <Input aria-label="Opportunity value" type="number" defaultValue={o.value} onBlur={(e) => Number(e.target.value) !== o.value && setOppValue(o.id, Number(e.target.value))} className="!w-32 !py-1 text-right" /> : <span className="font-semibold tabular-nums">{mask(seeVal, money(o.value))}</span>}</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Field label="Stage">{(fid) => <Select id={fid} disabled={!edit} value={o.stageId} onChange={(e) => { const r = moveOpp(o.id, e.target.value); if (!r.ok) toast(r.error ?? "", "bad"); }}>{p?.stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}</Select>}</Field>
                      {fields.map((f) => <CustomInput key={f.id} f={f} disabled={!edit} value={o.custom[f.id] ?? ""} onChange={(v) => setOppCustom(o.id, f.id, v)} />)}
                    </div>
                    <div className="mt-2 flex gap-2"><Button size="sm" variant="secondary" onClick={() => setPay(o.id)}><CreditCard size={14} />Request payment</Button>
                      <Link to={`/calendar?contact=${c.id}&opp=${o.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium"><CalendarPlus size={14} />Book appointment</Link></div>
                  </li>);
              })}</ul>)}
          </Card>
          {cFields.length > 0 && <Card><h2 className="mb-3 font-semibold">Details</h2><div className="grid gap-2 sm:grid-cols-2">{cFields.map((f) => <CustomInput key={f.id} f={f} disabled={!edit} value={c.custom[f.id] ?? ""} onChange={(v) => setContactCustom(c.id, f.id, v)} />)}</div></Card>}
          <Card>
            <h2 className="mb-3 font-semibold">Conversation · WhatsApp</h2>
            <ul className="mb-3 max-h-80 space-y-2 overflow-auto" aria-label="Messages">{msgs.length === 0 && <li className="text-sm text-muted">No messages yet.</li>}
              {msgs.map((m) => (
                <li key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : ""}`}>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.direction === "out" ? "bg-brand/15" : "bg-surface2"}`}>
                    <p>{m.body}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">{ago(m.at)}{m.direction === "out" && <Badge tone={statusTone[m.status]}>{m.status}</Badge>}
                      {m.status === "failed" && !c.optedOut && <button className="font-medium text-brand underline" onClick={() => retryMessage(m.id)}>Retry</button>}</p>
                    {m.error && <p role="alert" className="mt-1 text-xs text-bad">{m.error}</p>}
                  </div>
                </li>))}</ul>
            {c.optedOut ? <p role="note" className="rounded-lg bg-bad/10 p-3 text-sm text-bad">Messaging is disabled: this contact opted out. They have to ask to be contacted again before you can remove the opt-out.</p> : (
              <form onSubmit={send} className="flex gap-2"><Input aria-label="Message" placeholder="Type a reply…" value={msg} onChange={(e) => setMsg(e.target.value)} /><Button type="submit" disabled={!msg.trim()}>Send</Button></form>)}
          </Card>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Card><h2 className="mb-3 font-semibold">Payments & appointments</h2>
            {pays.length + appts.length === 0 && <p className="text-sm text-muted">Nothing yet.</p>}
            <ul className="space-y-2 text-sm">{pays.map((p) => <li key={p.id} className="flex items-center justify-between gap-2"><span>{mask(seeVal, money(p.amount, p.currency))} <span className="text-xs text-muted">{p.ref}</span></span><Badge tone={p.status === "paid" ? "ok" : p.status === "pending" ? "warn" : "bad"}>{p.status}</Badge></li>)}
              {appts.map((a) => <li key={a.id} className="flex items-center justify-between gap-2"><span>{a.title}<span className="block text-xs text-muted">{fmtTime(a.start)} · {nameOf(s, a.memberId)}</span></span><Badge tone={a.status === "confirmed" ? "ok" : "neutral"}>{a.status}</Badge></li>)}</ul></Card>
          <Card>
            <h2 className="mb-3 font-semibold">Activity</h2>
            <form onSubmit={(e) => { e.preventDefault(); addNote(c.id, note); setNote(""); }} className="mb-3 space-y-2"><Textarea aria-label="Add a note" rows={2} placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} /><Button size="sm" type="submit" disabled={!note.trim()}>Add note</Button></form>
            <ol className="space-y-2.5">{acts.map((a) => <li key={a.id} className="border-l-2 border-line pl-3 text-sm"><p>{a.text}</p><p className="text-xs text-muted"><Badge className="mr-1">{a.type}</Badge>{nameOf(s, a.actor)} · {ago(a.at)}</p></li>)}</ol>
          </Card>
        </div>
      </div>
      <RequestPayment oppId={pay} onClose={() => setPay(null)} />
    </>
  );
}
