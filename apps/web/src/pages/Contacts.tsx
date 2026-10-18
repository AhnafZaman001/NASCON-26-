import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { useApp, canSeeContact } from "@/lib/app";
import { download } from "@/lib/api";
import { addContact, deleteList, matchesCriteria, saveList } from "@/lib/store";
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, toast } from "@/components/ui";
import type { Criterion } from "@/lib/types";

const PAGE = 10;
export default function Contacts() {
  const { s, me, can } = useApp(); const [q, setQ] = useState(""); const [crit, setCrit] = useState<Criterion[]>([]); const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false); const [f, setF] = useState({ name: "", phone: "", email: "", companyId: "" }); const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false); const [listName, setListName] = useState("");
  const canView = can("crm.view"); const seeVal = can("values.view");
  const all = useMemo(() => s.contacts.filter((c) => canSeeContact(s, me?.id ?? null, canView, c.id)), [s, me, canView]);
  const rows = useMemo(() => all.filter((c) => (!q || (c.name + c.phone + c.email).toLowerCase().includes(q.toLowerCase())) && matchesCriteria(s, c, crit)), [all, q, crit, s]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); const cur = Math.min(page, pages - 1); const shown = rows.slice(cur * PAGE, cur * PAGE + PAGE);
  const tags = [...new Set(s.contacts.flatMap((c) => c.tags))];
  const stages = s.pipelines.flatMap((p) => p.stages.map((st) => ({ id: st.id, label: `${p.name} · ${st.name}` })));
  const co = (id: string | null) => s.companies.find((c) => c.id === id)?.name ?? "—";
  const upd = (i: number, patch: Partial<Criterion>) => { setCrit(crit.map((c, j) => (j === i ? { ...c, ...patch } : c))); setPage(0); };

  const exportCsv = () => {
    // live: the server builds the file and masks values it shouldn't include (F1.4)
    if (s.mode === "live") { download("/export/contacts.csv", "contacts.csv").then(() => toast("Export ready.", "ok"), (e: Error) => toast(e.message, "bad")); return; }
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`; // CSV-injection safe
    const lines = [["Name", "Phone", "Email", "Company", "Tags", "Open value"].join(",")];
    for (const c of rows) { const v = s.opps.filter((o) => o.contactId === c.id).reduce((a, o) => a + o.value, 0); lines.push([c.name, c.phone, c.email, co(c.companyId), c.tags.join(";"), seeVal ? v : "hidden"].map(esc).join(",")); }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = "contacts.csv"; a.click(); toast(`Exported ${rows.length} contacts.`, "ok");
  };
  const create = (e: React.FormEvent) => { e.preventDefault(); if (!f.name.trim()) { setErr("Name is required."); return; } addContact({ name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), companyId: f.companyId || null }); setOpen(false); setF({ name: "", phone: "", email: "", companyId: "" }); setErr(""); toast("Contact created.", "ok"); };

  return (
    <>
      <PageHeader title="Contacts" sub={`${rows.length} of ${all.length} contacts`} actions={<>
        {can("crm.export") && <Button variant="secondary" onClick={exportCsv}><Download size={15} />Export</Button>}
        {can("crm.create") && <Button onClick={() => setOpen(true)}><Plus size={15} />New contact</Button>}</>} />
      {s.lists.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-muted">Saved lists</span>
          {s.lists.map((l) => (
            <span key={l.id} className="inline-flex items-center overflow-hidden rounded-full border border-line bg-surface text-sm">
              <button className="px-3 py-1 hover:bg-surface2" onClick={() => { setCrit(l.criteria); setPage(0); }}>{l.name} <span className="text-muted">({s.contacts.filter((c) => matchesCriteria(s, c, l.criteria)).length})</span></button>
              <button aria-label={`Delete list ${l.name}`} className="px-2 py-1 text-muted hover:text-bad" onClick={() => deleteList(l.id)}><Trash2 size={13} /></button></span>))}
        </div>
      )}
      <Card className="mb-4 space-y-3">
        <Field label="Search">{(id) => <Input id={id} placeholder="Name, phone or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />}</Field>
        {crit.map((c, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Field label={`Filter ${i + 1}`}>{(id) => <Select id={id} value={c.field} onChange={(e) => upd(i, { field: e.target.value as Criterion["field"], value: "" })}><option value="tag">Tag is</option><option value="stage">In stage</option><option value="owner">Owned by</option><option value="source">Source is</option><option value="createdDays">Created in last N days</option></Select>}</Field>
            <Field label="Value">{(id) => c.field === "tag" ? <Select id={id} value={c.value} onChange={(e) => upd(i, { value: e.target.value })}><option value="">Any…</option>{tags.map((t) => <option key={t}>{t}</option>)}</Select>
              : c.field === "stage" ? <Select id={id} value={c.value} onChange={(e) => upd(i, { value: e.target.value })}><option value="">Select…</option>{stages.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
              : c.field === "owner" ? <Select id={id} value={c.value} onChange={(e) => upd(i, { value: e.target.value })}><option value="">Select…</option>{s.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
              : c.field === "source" ? <Select id={id} value={c.value} onChange={(e) => upd(i, { value: e.target.value })}><option value="">Select…</option><option>web form</option><option>whatsapp</option><option>manual</option></Select>
              : <Input id={id} type="number" min="1" value={c.value} onChange={(e) => upd(i, { value: e.target.value })} />}</Field>
            <Button variant="ghost" size="sm" onClick={() => setCrit(crit.filter((_, j) => j !== i))}>Remove</Button>
          </div>))}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setCrit([...crit, { field: "tag", value: "" }])}>Add filter</Button>
          {crit.length > 0 && <Button variant="secondary" size="sm" onClick={() => setSaving(true)}>Save as list</Button>}
          {crit.length > 0 && <Button variant="ghost" size="sm" onClick={() => setCrit([])}>Clear</Button>}
        </div>
      </Card>
      {shown.length === 0 ? <Empty title="No contacts match" hint="Try removing a filter." /> : (
        <ul className="space-y-2">{shown.map((c) => (
          <li key={c.id}><Card className="flex flex-wrap items-center justify-between gap-2">
            <div><Link to={`/contacts/${c.id}`} className="font-medium hover:underline">{c.name}</Link><p className="text-xs text-muted">{c.phone} · {c.email || "no email"} · {co(c.companyId)}</p></div>
            <div className="flex flex-wrap gap-1.5">{c.optedOut && <Badge tone="bad">opted out</Badge>}{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>
          </Card></li>))}</ul>)}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm"><Button variant="secondary" size="sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</Button>
          <span aria-live="polite">Page {cur + 1} of {pages}</span><Button variant="secondary" size="sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</Button></div>)}
      <Modal open={open} onClose={() => setOpen(false)} title="New contact">
        <form onSubmit={create} className="space-y-3" noValidate>
          <Field label="Name" error={err}>{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
          <Field label="Email">{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Company">{(id) => <Select id={id} value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}><option value="">None</option>{s.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit">Create</Button></div>
        </form>
      </Modal>
      <Modal open={saving} onClose={() => setSaving(false)} title="Save as list">
        <form onSubmit={(e) => { e.preventDefault(); if (!listName.trim()) return; saveList(listName.trim(), crit); setSaving(false); setListName(""); toast("List saved. It updates automatically as records change.", "ok"); }} className="space-y-3">
          <Field label="List name" hint="Membership is recalculated live, not frozen.">{(id) => <Input id={id} value={listName} onChange={(e) => setListName(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setSaving(false)}>Cancel</Button><Button type="submit">Save</Button></div>
        </form>
      </Modal>
    </>
  );
}
