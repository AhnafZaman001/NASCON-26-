"use client";
import { useState } from "react";
import { useApp } from "@/lib/app";
import { nameOf } from "@/lib/store";
import { fmtTime } from "@/lib/utils";
import { Badge, Card, Empty, Field, Input, PageHeader, Select } from "@/components/ui";

export default function Audit() {
  const { s, can } = useApp(); const [type, setType] = useState(""); const [user, setUser] = useState(""); const [from, setFrom] = useState("");
  if (!can("audit.view")) return <Empty title="You don't have access to the audit log" hint="Ask the Owner for the 'view audit log' permission." />;
  const types = [...new Set(s.audit.map((a) => a.type))].sort();
  const rows = s.audit.filter((a) => (!type || a.type === type) && (!user || a.actor === user) && (!from || a.at >= new Date(from).getTime()));
  return (
    <>
      <PageHeader title="Audit log" sub="Append-only. No screen or endpoint can edit or delete these entries." />
      <Card className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Event type">{(id) => <Select id={id} value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{types.map((t) => <option key={t}>{t}</option>)}</Select>}</Field>
        <Field label="Actor">{(id) => <Select id={id} value={user} onChange={(e) => setUser(e.target.value)}><option value="">Everyone</option><option value="system">System</option>{s.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
        <Field label="From date">{(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
      </Card>
      {rows.length === 0 ? <Empty title="No matching entries" /> : (
        <ul className="space-y-2">{rows.slice(0, 100).map((a) => (
          <li key={a.id}><Card className="text-sm"><div className="flex flex-wrap items-center gap-2"><Badge tone="brand">{a.type}</Badge><span className="font-medium">{a.target}</span><span className="ml-auto text-xs text-muted">{fmtTime(a.at)} · {nameOf(s, a.actor)}</span></div>
            {(a.before || a.after) && <p className="mt-1.5 break-words text-xs text-muted"><span className="line-through">{a.before ?? "—"}</span> → <span className="text-fg">{a.after ?? "—"}</span></p>}</Card></li>))}</ul>)}
    </>
  );
}
