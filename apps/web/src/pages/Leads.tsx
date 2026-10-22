import { Link } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { Suspense, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "@/lib/app";
import { acknowledge, createManualLead, nameOf, reassignLead, recoveryItems } from "@/lib/store";
import { ago, startOfDay } from "@/lib/utils";
import { Badge, Button, Card, Countdown, Empty, Field, Input, Modal, PageHeader, Select, Tabs, toast, useNow } from "@/components/ui";
import type { Lead } from "@/lib/types";

function LeadsInner() {
  const { s, me, can, companyWide } = useApp(); const [q] = useSearchParams(); useNow(1000);
  const [tab, setTab] = useState<"mine" | "all" | "recovery">((q.get("tab") as "mine" | "all" | "recovery") || "mine");
  const [open, setOpen] = useState(false); const [f, setF] = useState({ name: "", phone: "", email: "" }); const [err, setErr] = useState("");
  const focusId = q.get("lead");   // alert emails link here (I4.2): /leads?lead=<id>
  useEffect(() => { if (focusId) document.getElementById(`lead-${focusId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focusId, s.leads.length]);
  if (!me) return null;
  const today = q.get("today") === "1";
  const rec = recoveryItems(s).filter((r) => companyWide || r.lead.ownerId === me.id);
  const recMap = new Map(rec.map((r) => [r.lead.id, r.reasons]));
  let rows: Lead[] = tab === "recovery" ? rec.map((r) => r.lead) : tab === "mine" ? s.leads.filter((l) => l.ownerId === me.id) : s.leads;
  if (today) rows = rows.filter((l) => l.createdAt >= startOfDay());
  const contactName = (id: string) => s.contacts.find((c) => c.id === id)?.name ?? "Unknown";
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || !f.phone.trim()) { setErr("Name and phone are required."); return; }
    createManualLead(f.name.trim(), f.phone.trim(), f.email.trim(), "manual"); setOpen(false); setF({ name: "", phone: "", email: "" }); setErr(""); toast("Lead created and assigned.", "ok");
  };
  const tabs = [{ key: "mine" as const, label: "My leads", count: s.leads.filter((l) => l.ownerId === me.id).length }, ...(companyWide ? [{ key: "all" as const, label: "All leads", count: s.leads.length }] : []), { key: "recovery" as const, label: "Recovery queue", count: rec.length }];
  return (
    <>
      <PageHeader title="Leads" sub={`Escalation windows: ${s.settings.levels.map((l) => l.seconds + "s").join(" → ")}. Every lead has exactly one accountable owner.`}
        actions={can("crm.create") && <Button onClick={() => setOpen(true)}><Plus size={15} />New lead</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3"><Tabs tabs={tabs} value={tab} onChange={setTab} />{today && <Badge tone="brand">Created today</Badge>}</div>
      {rows.length === 0 ? <Empty title={tab === "recovery" ? "Nothing is slipping through" : "No leads here"} hint={tab === "recovery" ? "Leads that go unacknowledged, escalate repeatedly or sit idle show up here with the reason." : "New leads from the web form, WhatsApp or manual entry appear instantly."} /> : (
        <ul className="space-y-2">
          {rows.map((l) => {
            const owner = s.members.find((m) => m.id === l.ownerId); const reasons = recMap.get(l.id);
            return (
              <li key={l.id} id={`lead-${l.id}`}><Card className={`flex flex-wrap items-center gap-3${l.id === focusId ? " ring-2 ring-brand" : ""}`}>
                <div className="min-w-0 flex-1">
                  <Link to={`/contacts/${l.contactId}`} className="font-medium hover:underline">{contactName(l.contactId)}</Link>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <Badge>{l.source}</Badge><span>created {ago(l.createdAt)}</span><span>·</span>
                    <span>owner: <strong className="text-fg">{owner ? owner.name : "nobody yet"}</strong></span>
                    {l.level > 0 && <Badge tone="warn">Level {l.level + 1}</Badge>}
                  </div>
                  {reasons && <ul className="mt-1.5 flex flex-wrap gap-1.5">{reasons.map((r) => <li key={r}><Badge tone="bad">{r}</Badge></li>)}</ul>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {l.status === "assigned" && l.deadlineAt && <Countdown deadline={l.deadlineAt} />}
                  {l.status === "acknowledged" && <Badge tone="ok">Acknowledged{l.ackedBy ? ` by ${nameOf(s, l.ackedBy).split(" ")[0]}` : ""}</Badge>}
                  {l.status === "unassigned" && <Badge tone="bad">Unassigned</Badge>}
                  {l.status === "assigned" && l.ownerId === me.id && <Button size="sm" onClick={() => { acknowledge(l.id); toast("Acknowledged. The timer is stopped.", "ok"); }}>Acknowledge</Button>}
                  {can("assignment.manage") && (
                    <Select aria-label={`Reassign ${contactName(l.contactId)}`} value="" onChange={(e) => { if (e.target.value) { reassignLead(l.id, e.target.value); toast("Lead reassigned.", "ok"); } }} className="!w-auto !py-1.5 !text-xs">
                      <option value="">Reassign…</option>{s.members.filter((m) => m.id !== l.ownerId).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.status})</option>)}
                    </Select>)}
                </div>
              </Card></li>
            );
          })}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New lead">
        <form onSubmit={submit} className="space-y-3" noValidate>
          <Field label="Name">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Phone" hint="Used to match existing contacts.">{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
          <Field label="Email (optional)" error={err}>{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit">Create & assign</Button></div>
        </form>
      </Modal>
    </>
  );
}
export default function LeadsPage() { return <Suspense fallback={null}><LeadsInner /></Suspense>; }
