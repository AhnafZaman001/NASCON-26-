import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/app";
import { api } from "@/lib/api";
import { nameOf } from "@/lib/store";
import { fmtTime } from "@/lib/utils";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select } from "@/components/ui";

type Change = { key: string; before: string; after: string };
type Entry = { id: string | number; at: number; actor: string; type: string; target: string; changes: Change[]; before?: string; after?: string };
type ServerPage = {
  items: { id: number; at: string; actor: string; type: string; target: string; changes: Change[] }[];
  nextCursor: number | null;
};

// "members.update" -> "Member changed"; "lead.escalated" -> "Lead escalated"
const TABLES: Record<string, string> = {
  workspaces: "Workspace", roles: "Role", members: "Team member", pipelines: "Pipeline", stages: "Stage",
  field_definitions: "Custom field", stage_required_fields: "Required field", integrations: "Integration",
  contacts: "Contact", companies: "Company", opportunities: "Opportunity",
};
const OPS: Record<string, string> = { insert: "created", update: "changed", delete: "deleted" };
function label(type: string) {
  const [a, b] = type.split(".");
  if (TABLES[a] && OPS[b]) return `${TABLES[a]} ${OPS[b]}`;
  const s = type.replace(/[._]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const human = (k: string) => k.replace(/_id$/, "").replace(/_/g, " ");
const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

export default function Audit() {
  const { s, can } = useApp();
  const live = s.mode === "live";
  const [type, setType] = useState(""); const [user, setUser] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [items, setItems] = useState<Entry[]>([]); const [types, setTypes] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const allowed = can("audit.view");

  const load = useCallback(async (after?: number) => {
    setLoading(true); setError("");
    const q = new URLSearchParams();
    if (type) q.set("type", type);
    if (user) q.set("actor", user);
    const f = dayStart(from), t = dayEnd(to);
    if (f) q.set("from", f);
    if (t) q.set("to", t);
    if (after) q.set("cursor", String(after));
    try {
      const p = await api<ServerPage>(`/audit?${q}`);
      const mapped = p.items.map((i) => ({ ...i, at: new Date(i.at).getTime() }));
      setItems((prev) => (after ? [...prev, ...mapped] : mapped));
      setCursor(p.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the audit log.");
    } finally { setLoading(false); }
  }, [type, user, from, to]);

  useEffect(() => { if (live && allowed) void load(); }, [live, allowed, load]);
  useEffect(() => {
    if (live && allowed) api<{ types: string[] }>("/audit/types").then((r) => setTypes(r.types)).catch(() => {});
  }, [live, allowed]);

  if (!allowed) return <Empty title="You don't have access to the audit log" hint="Ask the Owner for the 'view audit log' permission." />;

  // Demo mode: the sample workspace's log lives in this browser.
  const demoRows: Entry[] = live ? [] : s.audit
    .filter((a) => (!type || a.type === type) && (!user || a.actor === user) && (!from || a.at >= new Date(`${from}T00:00:00`).getTime()) && (!to || a.at <= new Date(`${to}T23:59:59.999`).getTime()))
    .slice(0, 100)
    .map((a) => ({ id: a.id, at: a.at, actor: nameOf(s, a.actor), type: a.type, target: a.target, changes: [], before: a.before, after: a.after }));
  const rows = live ? items : demoRows;
  const typeOptions = live ? types : [...new Set(s.audit.map((a) => a.type))].sort();

  return (
    <>
      <PageHeader title="Audit log" sub="Append-only. No screen or endpoint can edit or delete these entries." />
      <Card className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Event type">{(id) => <Select id={id} value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{typeOptions.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select>}</Field>
        <Field label="Actor">{(id) => <Select id={id} value={user} onChange={(e) => setUser(e.target.value)}><option value="">Everyone</option><option value="system">System</option>{s.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
        <Field label="From">{(id) => <Input id={id} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />}</Field>
      </Card>

      {error && (
        <Card className="mb-4 border-bad text-sm" ><p role="alert"><span className="font-medium">Couldn&apos;t load the audit log.</span> {error}</p>
          <Button className="mt-2" size="sm" variant="secondary" onClick={() => void load()}>Try again</Button></Card>
      )}

      {rows.length === 0 ? (
        loading ? <p className="text-sm text-muted" role="status">Loading entries…</p> : !error && <Empty title="No matching entries" hint={type || user || from || to ? "Try widening the filters." : undefined} />
      ) : (
        <ul className="space-y-2" aria-busy={loading}>{rows.map((a) => (
          <li key={a.id}><Card className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand" className="font-mono">{label(a.type)}</Badge>
              <span className="font-medium">{a.target}</span>
              <span className="ml-auto text-xs text-muted"><time dateTime={new Date(a.at).toISOString()}>{fmtTime(a.at)}</time> · {a.actor}</span>
            </div>
            {a.changes.length > 0 && (
              <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[minmax(7rem,auto)_1fr]">
                {a.changes.map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-muted">{human(c.key)}</dt>
                    <dd className="break-words">
                      {c.before && <><span className="text-muted line-through" aria-label={`before: ${c.before}`}>{c.before}</span>{c.after && " → "}</>}
                      {c.after && <span aria-label={c.before ? `after: ${c.after}` : undefined}>{c.after}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {(a.before || a.after) && <p className="mt-1.5 break-words text-xs text-muted"><span className="line-through">{a.before ?? "—"}</span> → <span className="text-fg">{a.after ?? "—"}</span></p>}
          </Card></li>))}
        </ul>
      )}

      {live && cursor && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" disabled={loading} onClick={() => void load(cursor)}>{loading ? "Loading…" : "Load older entries"}</Button>
        </div>
      )}
    </>
  );
}
