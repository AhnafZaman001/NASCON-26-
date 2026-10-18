"use client";
import Link from "next/link";
import { useState } from "react";
import { useApp, mask } from "@/lib/app";
import { addOpp, moveOpp, nameOf } from "@/lib/store";
import { money } from "@/lib/utils";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Tabs, toast } from "@/components/ui";

export default function Pipeline() {
  const { s, can } = useApp(); const [pid, setPid] = useState(s.pipelines[0]?.id ?? ""); const [drag, setDrag] = useState<string | null>(null);
  const [open, setOpen] = useState(false); const [f, setF] = useState({ contactId: "", title: "", value: "" }); const [err, setErr] = useState("");
  const p = s.pipelines.find((x) => x.id === pid) ?? s.pipelines[0]; if (!p) return null;
  const seeVal = can("value.view");
  const move = (oppId: string, stageId: string) => { const r = moveOpp(oppId, stageId); if (!r.ok) toast(r.error ?? "Could not move.", "bad"); };
  const create = (e: React.FormEvent) => { e.preventDefault(); if (!f.contactId || !f.title.trim()) { setErr("Choose a contact and give the opportunity a title."); return; } addOpp(f.contactId, p.id, f.title.trim(), Number(f.value) || 0); setOpen(false); setF({ contactId: "", title: "", value: "" }); setErr(""); toast("Opportunity created.", "ok"); };
  return (
    <>
      <PageHeader title="Pipeline" sub="Drag cards between stages, or use the stage menu on each card (works with keyboard too)." actions={can("crm.create") && <Button onClick={() => setOpen(true)}>New opportunity</Button>} />
      <div className="mb-4 overflow-x-auto"><Tabs tabs={s.pipelines.map((x) => ({ key: x.id, label: x.name, count: s.opps.filter((o) => o.pipelineId === x.id).length }))} value={p.id} onChange={setPid} /></div>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {p.stages.map((st) => {
          const items = s.opps.filter((o) => o.pipelineId === p.id && o.stageId === st.id);
          return (
            <section key={st.id} aria-label={st.name} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag) move(drag, st.id); setDrag(null); }}
              className="w-72 shrink-0 rounded-xl border border-line bg-surface2/60 p-2.5">
              <header className="mb-2 flex items-center justify-between px-1"><h2 className="text-sm font-semibold">{st.name}</h2>
                <div className="flex items-center gap-1">{st.kind !== "open" && <Badge tone={st.kind === "won" ? "ok" : "bad"}>{st.kind}</Badge>}<Badge>{items.length}</Badge></div></header>
              {st.required.length > 0 && <p className="mb-2 px-1 text-xs text-muted">Requires: {st.required.map((r) => s.fields.find((f) => f.id === r)?.name).join(", ")}</p>}
              <ul className="space-y-2">{items.map((o) => (
                <li key={o.id} draggable={can("crm.edit")} onDragStart={() => setDrag(o.id)} onDragEnd={() => setDrag(null)}>
                  <Card className="cursor-grab p-3 active:cursor-grabbing">
                    <Link href={`/contacts/${o.contactId}`} className="text-sm font-medium hover:underline">{o.title}</Link>
                    <p className="text-xs text-muted">{s.contacts.find((c) => c.id === o.contactId)?.name} · {nameOf(s, o.ownerId)}</p>
                    <p className="mt-1 text-sm font-semibold tabular-nums">{mask(seeVal, money(o.value))}</p>
                    {can("crm.edit") && <Select aria-label={`Move ${o.title} to stage`} value={o.stageId} onChange={(e) => move(o.id, e.target.value)} className="mt-2 !py-1 !text-xs">{p.stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}
                  </Card></li>))}</ul>
            </section>
          );
        })}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={`New opportunity in ${p.name}`}>
        <form onSubmit={create} className="space-y-3" noValidate>
          <Field label="Contact">{(id) => <Select id={id} value={f.contactId} onChange={(e) => setF({ ...f, contactId: e.target.value })}><option value="">Select…</option>{s.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Title">{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          {seeVal && <Field label="Value (USD)" error={err}>{(id) => <Input id={id} type="number" min="0" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}</Field>}
          {!seeVal && err && <p role="alert" className="text-xs text-bad">{err}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit">Create</Button></div>
        </form>
      </Modal>
    </>
  );
}
