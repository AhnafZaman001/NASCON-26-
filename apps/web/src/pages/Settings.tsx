import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useApp } from "@/lib/app";
import { addField, addPipeline, addStage, deleteField, deleteStage, deleteRole, inviteMember, moveStage, removeMember, renameStage, saveRole, setSettings, setStageRequired, updateMember } from "@/lib/store";
import { ALL_PERMS, type FieldType, type Level, type LevelCfg, type Perm, type Role } from "@/lib/types";
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Tabs, toast } from "@/components/ui";

function PipelineTab() {
  const { s, can } = useApp(); const [pid, setPid] = useState(s.pipelines[0]?.id ?? ""); const [stage, setStage] = useState(""); const [pname, setPname] = useState("");
  const [fd, setFd] = useState({ name: "", type: "text" as FieldType, entity: "opportunity" as "contact" | "opportunity", options: "" }); const [del, setDel] = useState<{ sid: string; to: string; err: string } | null>(null);
  const p = s.pipelines.find((x) => x.id === pid) ?? s.pipelines[0]; const ok = can("pipelines.manage");
  if (!ok) return <Empty title="You can't customize pipelines" hint="Ask an Admin for the 'customize pipelines & fields' permission." />;
  if (s.mode === "live") return <Empty title="Pipeline and field editing is moving to the server" hint="Your pipelines, stages and fields are loaded from the database. Editing them here comes with the next update (M3)." />;
  const fields = s.fields.filter((f) => f.entity === "opportunity" && f.pipelineId === p?.id);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3"><h2 className="font-semibold">Stages</h2>
        <div className="flex gap-2"><Select aria-label="Pipeline" value={p?.id} onChange={(e) => setPid(e.target.value)}>{s.pipelines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></div>
        <ul className="space-y-2">{p?.stages.map((st, i) => (
          <li key={st.id} className="rounded-lg border border-line p-2.5">
            <div className="flex items-center gap-2"><Input aria-label="Stage name" defaultValue={st.name} onBlur={(e) => e.target.value !== st.name && renameStage(p.id, st.id, e.target.value)} />
              {st.kind !== "open" && <Badge tone={st.kind === "won" ? "ok" : "bad"}>{st.kind}</Badge>}
              <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => moveStage(p.id, st.id, -1)}><ArrowUp size={14} /></Button>
              <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === p.stages.length - 1} onClick={() => moveStage(p.id, st.id, 1)}><ArrowDown size={14} /></Button>
              <Button size="sm" variant="ghost" aria-label={`Delete stage ${st.name}`} onClick={() => { const r = deleteStage(p.id, st.id); if (!r.ok) setDel({ sid: st.id, to: "", err: r.error ?? "" }); else toast("Stage deleted.", "ok"); }}><Trash2 size={14} /></Button></div>
            {fields.length > 0 && <fieldset className="mt-2"><legend className="text-xs text-muted">Required before entering this stage</legend><div className="mt-1 flex flex-wrap gap-3">{fields.map((f) => (
              <label key={f.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-[var(--brand)]" checked={st.required.includes(f.id)} onChange={(e) => setStageRequired(p.id, st.id, e.target.checked ? [...st.required, f.id] : st.required.filter((x) => x !== f.id))} />{f.name}</label>))}</div></fieldset>}
          </li>))}</ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (stage.trim() && p) { addStage(p.id, stage.trim()); setStage(""); } }}><Input aria-label="New stage name" placeholder="New stage" value={stage} onChange={(e) => setStage(e.target.value)} /><Button type="submit" variant="secondary">Add</Button></form>
        <form className="flex gap-2 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); if (pname.trim()) { addPipeline(pname.trim()); setPname(""); } }}><Input aria-label="New pipeline name" placeholder="New pipeline" value={pname} onChange={(e) => setPname(e.target.value)} /><Button type="submit" variant="secondary">Create pipeline</Button></form>
      </Card>
      <Card className="space-y-3"><h2 className="font-semibold">Custom fields</h2>
        <ul className="space-y-1.5 text-sm">{s.fields.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2"><span>{f.name} <span className="text-xs text-muted">· {f.type} · {f.entity === "contact" ? "all contacts" : s.pipelines.find((x) => x.id === f.pipelineId)?.name}</span></span>
            <Button size="sm" variant="ghost" aria-label={`Delete field ${f.name}`} onClick={() => { if (confirm(`Delete "${f.name}" and its values everywhere?`)) deleteField(f.id); }}><Trash2 size={14} /></Button></li>))}</ul>
        <form className="space-y-2 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); if (!fd.name.trim()) return; addField(fd.name.trim(), fd.type, fd.entity, p?.id ?? null, fd.type === "dropdown" ? fd.options.split(",").map((o) => o.trim()).filter(Boolean) : undefined); setFd({ ...fd, name: "", options: "" }); toast("Field added. It's on forms immediately.", "ok"); }}>
          <Field label="Field name">{(id) => <Input id={id} value={fd.name} onChange={(e) => setFd({ ...fd, name: e.target.value })} />}</Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Type">{(id) => <Select id={id} value={fd.type} onChange={(e) => setFd({ ...fd, type: e.target.value as FieldType })}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="dropdown">Dropdown</option><option value="checkbox">Checkbox</option></Select>}</Field>
            <Field label="Applies to">{(id) => <Select id={id} value={fd.entity} onChange={(e) => setFd({ ...fd, entity: e.target.value as "contact" | "opportunity" })}><option value="opportunity">Opportunities in {p?.name}</option><option value="contact">All contacts</option></Select>}</Field></div>
          {fd.type === "dropdown" && <Field label="Options" hint="Comma separated">{(id) => <Input id={id} value={fd.options} onChange={(e) => setFd({ ...fd, options: e.target.value })} />}</Field>}
          <Button type="submit">Add field</Button></form>
      </Card>
      <Modal open={!!del} onClose={() => setDel(null)} title="Move opportunities before deleting">
        <p className="mb-3 text-sm text-muted">{del?.err}</p>
        <Field label="Move them to">{(id) => <Select id={id} value={del?.to ?? ""} onChange={(e) => setDel({ ...del!, to: e.target.value })}><option value="">Select a stage…</option>{p?.stages.filter((x) => x.id !== del?.sid).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" onClick={() => { const r = deleteStage(p!.id, del!.sid, del!.to); if (r.ok) { setDel(null); toast("Stage deleted and opportunities moved.", "ok"); } else setDel({ ...del!, err: r.error ?? "" }); }}>Move & delete</Button></div>
      </Modal>
    </div>
  );
}

function AssignmentTab() {
  const { s, can } = useApp(); const st = s.settings;
  if (!can("assignment.manage")) return <Empty title="You can't manage assignment rules" />;
  const setLevel = (i: number, patch: Partial<LevelCfg>) => setSettings({ levels: st.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3"><h2 className="font-semibold">Distribution</h2>
        <p className="text-sm text-muted">Leads go round-robin to Available employees only, and nobody gets more than the open-lead cap.</p>
        <Field label="Max open leads per employee">{(id) => <Input id={id} type="number" min="1" defaultValue={st.maxOpenLeads} onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== st.maxOpenLeads && setSettings({ maxOpenLeads: Number(e.target.value) })} />}</Field>
        <Field label="Idle period before a lead hits the recovery queue (seconds)">{(id) => <Input id={id} type="number" min="10" defaultValue={st.idleSeconds} onBlur={(e) => Number(e.target.value) > 0 && setSettings({ idleSeconds: Number(e.target.value) })} />}</Field>
        <Field label="Designated backup">{(id) => <Select id={id} value={st.backupId ?? ""} onChange={(e) => setSettings({ backupId: e.target.value })}>{s.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
        <Field label="Manager (final escalation)">{(id) => <Select id={id} value={st.managerId ?? ""} onChange={(e) => setSettings({ managerId: e.target.value })}>{s.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
        <Field label="When someone goes on leave or offline" hint="Unacknowledged leads are always reassigned immediately.">{(id) => <Select id={id} value={st.ackedOnAbsence} onChange={(e) => setSettings({ ackedOnAbsence: e.target.value as "keep" | "reassign" })}><option value="keep">Keep acknowledged leads with them (flagged in recovery queue)</option><option value="reassign">Reassign acknowledged leads too</option></Select>}</Field>
      </Card>
      <Card className="space-y-3"><h2 className="font-semibold">Escalation chain</h2>
        <p className="text-sm text-muted">Each level gets a window (seconds) to acknowledge before the lead moves on. Short values make it easy to demo.</p>
        <ol className="space-y-2">{st.levels.map((l, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2"><span className="w-14 text-sm font-medium">Level {i + 1}</span>
            <Select aria-label={`Level ${i + 1} target`} value={l.target} onChange={(e) => setLevel(i, { target: e.target.value as LevelCfg["target"] })} className="!w-auto"><option value="assignee">Initial assignee</option><option value="next">Next eligible employee</option><option value="backup">Designated backup</option><option value="manager">Manager</option></Select>
            <Input aria-label={`Level ${i + 1} seconds`} type="number" min="5" defaultValue={l.seconds} onBlur={(e) => Number(e.target.value) >= 5 && setLevel(i, { seconds: Number(e.target.value) })} className="!w-20" /><span className="text-xs text-muted">sec</span>
            {st.levels.length > 1 && <Button size="sm" variant="ghost" aria-label={`Remove level ${i + 1}`} onClick={() => setSettings({ levels: st.levels.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>}</li>))}</ol>
        <Button variant="secondary" size="sm" onClick={() => setSettings({ levels: [...st.levels, { target: "manager", seconds: 60 }] })}>Add level</Button>
      </Card>
    </div>
  );
}

function RoleCard({ role, used, editable }: { role: Role; used: number; editable: boolean }) {
  const [name, setName] = useState(role.name);
  const toggle = (p: Perm, on: boolean) => saveRole(role.id, role.name, on ? [...role.perms, p] : role.perms.filter((x) => x !== p));
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Field label="Role name">{(id) => <Input id={id} value={name} disabled={!editable} onChange={(e) => setName(e.target.value)}
          onBlur={() => { if (name.trim() && name.trim() !== role.name) saveRole(role.id, name.trim(), role.perms); else setName(role.name); }} />}</Field>
        <div className="flex items-center gap-2 text-xs text-muted">{used} {used === 1 ? "member" : "members"}
          {editable && <Button variant="ghost" size="sm" aria-label={`Delete role ${role.name}`} onClick={() => { if (confirm(`Delete the role "${role.name}"? ${used ? `${used} member(s) will lose its permissions.` : ""}`)) deleteRole(role.id); }}><Trash2 size={14} /></Button>}</div>
      </div>
      <fieldset disabled={!editable}><legend className="mb-1 text-xs font-medium text-muted">Permissions</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">{ALL_PERMS.map((p) => (
          <label key={p.key} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--brand)]" checked={role.perms.includes(p.key)} onChange={(e) => toggle(p.key, e.target.checked)} />{p.label}</label>))}</div>
      </fieldset>
    </Card>
  );
}

function TeamTab() {
  const { s, me } = useApp();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [f, setF] = useState({ name: "", email: "", level: "user" as Exclude<Level, "owner">, roleId: s.roles[0]?.id ?? "" });
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const [newRole, setNewRole] = useState("");
  const manages = !!me && (me.level !== "user" || me.perms.includes("users.manage"));
  if (!me || !manages) return <Empty title="Only the Owner and Admins manage the team" />;
  const locked = (m: { level: Level }) => m.level === "owner" || (m.level === "admin" && me.level !== "owner");
  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || !/^\S+@\S+\.\S+$/.test(f.email)) { setErr("Enter a name and a valid email."); return; }
    setBusy(true); setErr("");
    const res = await inviteMember(f.name.trim(), f.email.trim(), f.level, f.roleId || null);
    setBusy(false);
    if (!res) return; // error already shown
    setOpen(false); setF({ ...f, name: "", email: "" });
    if (res.tempPassword) setTemp({ email: f.email.trim(), password: res.tempPassword });
    else toast(`${f.name.trim()} added.`, "ok");
  };
  return (
    <div className="space-y-6">
      <section aria-labelledby="team-h" className="space-y-3">
        <div className="flex items-center justify-between"><h2 id="team-h" className="font-semibold">Team</h2><Button onClick={() => setOpen(true)}>Invite user</Button></div>
        <ul className="space-y-3">{s.members.map((m) => (
          <li key={m.id}><Card className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-medium">{m.name} <Badge tone={m.level === "owner" ? "brand" : "neutral"}>{m.level}</Badge></p><p className="text-xs text-muted">{m.email} · {m.roleName}</p></div>
            {m.level === "owner" ? <p className="text-xs text-muted">The Owner always has every permission and can&apos;t be modified.</p> : (
              <div className="flex flex-wrap gap-2">
                <Select aria-label={`Level for ${m.name}`} disabled={locked(m)} value={m.level} onChange={(e) => updateMember(m.id, { level: e.target.value as Exclude<Level, "owner"> })} className="!w-auto !py-1.5">
                  <option value="user">User</option><option value="admin" disabled={me.level !== "owner"}>Admin</option></Select>
                <Select aria-label={`Role for ${m.name}`} disabled={locked(m)} value={m.roleId ?? ""} onChange={(e) => updateMember(m.id, { roleId: e.target.value || null })} className="!w-auto !py-1.5">
                  <option value="">No role</option>{s.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
                {!locked(m) && m.id !== me.id && <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Remove ${m.name}? Their open leads are reassigned and their login is deleted.`)) removeMember(m.id); }}>Remove</Button>}
              </div>)}
          </Card></li>))}</ul>
      </section>

      <section aria-labelledby="roles-h" className="space-y-3">
        <div><h2 id="roles-h" className="font-semibold">Roles</h2><p className="text-sm text-muted">A role is a named set of permissions. Changing a role changes it for everyone who has it. The server enforces these on every request.</p></div>
        <div className="grid gap-3 lg:grid-cols-2">{s.roles.map((r) => <RoleCard key={r.id + r.name} role={r} used={s.members.filter((m) => m.roleId === r.id).length} editable />)}</div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!newRole.trim()) return; saveRole(null, newRole.trim(), ["crm.view"]); setNewRole(""); }}>
          <Field label="New role">{(id) => <Input id={id} placeholder="e.g. Team Lead" value={newRole} onChange={(e) => setNewRole(e.target.value)} />}</Field>
          <Button type="submit" variant="secondary" disabled={!newRole.trim()}>Add role</Button>
        </form>
      </section>

      <Modal open={open} onClose={() => setOpen(false)} title="Invite user">
        <form noValidate className="space-y-3" onSubmit={invite} aria-busy={busy}>
          <Field label="Name">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Email" error={err || undefined}>{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Level">{(id) => <Select id={id} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as Exclude<Level, "owner"> })}><option value="user">User</option>{me.level === "owner" && <option value="admin">Admin</option>}</Select>}</Field>
          <Field label="Role" hint="Access comes from the role's permissions.">{(id) => <Select id={id} value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}><option value="">No role</option>{s.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Inviting…" : "Invite"}</Button></div>
        </form>
      </Modal>

      <Modal open={!!temp} onClose={() => setTemp(null)} title="Share these sign-in details">
        <div className="space-y-3 text-sm">
          <p>The account is ready. Send these to <strong>{temp?.email}</strong>. The password is shown only once.</p>
          <p className="rounded-lg border border-line bg-surface2 p-3 font-mono">{temp?.email}<br />{temp?.password}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(`${temp?.email}\n${temp?.password}`); toast("Copied.", "ok"); }}>Copy</Button>
            <Button onClick={() => setTemp(null)}>Done</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<"pipeline" | "assign" | "team">("pipeline");
  return (<><PageHeader title="Settings" sub="Shape the CRM and the lead rules without a developer." />
    <div className="mb-4"><Tabs tabs={[{ key: "pipeline", label: "Pipelines & fields" }, { key: "assign", label: "Assignment & escalation" }, { key: "team", label: "Team & roles" }]} value={tab} onChange={setTab} /></div>
    {tab === "pipeline" ? <PipelineTab /> : tab === "assign" ? <AssignmentTab /> : <TeamTab />}</>);
}
