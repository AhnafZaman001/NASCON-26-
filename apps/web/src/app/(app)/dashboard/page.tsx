"use client";
import Link from "next/link";
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useApp, mask } from "@/lib/app";
import { recoveryItems, toggleTile } from "@/lib/store";
import { money, startOfDay } from "@/lib/utils";
import { Badge, Button, Card, PageHeader, Stat, useNow } from "@/components/ui";

const TILES = [
  ["newToday", "New leads today"], ["ttfr", "Avg. time to first response"], ["recovery", "Recovery queue"], ["esc", "Escalations (24h)"],
  ["collected", "Collected this month"], ["appts", "Upcoming appointments"], ["pipeline", "Open pipeline by stage"], ["team", "Employee availability"],
] as const;

export default function Dashboard() {
  const { s, me, can, companyWide } = useApp(); const [cust, setCust] = useState(false); const t = useNow(5000);
  if (!me) return null;
  const hidden = s.hiddenTiles[me.id] ?? []; const show = (k: string) => !hidden.includes(k);
  const seeVal = can("value.view");
  const myLeads = s.leads.filter((l) => companyWide || l.ownerId === me.id || l.ackedBy === me.id);
  const newToday = myLeads.filter((l) => l.createdAt >= startOfDay()).length;
  const acked = myLeads.filter((l) => l.ackedAt && l.firstAssignedAt && (companyWide || l.ackedBy === me.id));
  const avg = acked.length ? acked.reduce((a, l) => a + (l.ackedAt! - l.firstAssignedAt!), 0) / acked.length : null;
  const fmtDur = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : ms < 3600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3600_000).toFixed(1)}h`);
  const rec = recoveryItems(s).filter((r) => companyWide || r.lead.ownerId === me.id).length;
  const esc = myLeads.flatMap((l) => l.history).filter((h) => h.kind === "escalate" && h.at > t - 86400_000).length;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const pays = s.payments.filter((p) => (companyWide || p.requestedBy === me.id) && p.at >= monthStart);
  const collected = pays.filter((p) => p.status === "paid").reduce((a, p) => a + p.amount, 0);
  const appts = s.appointments.filter((a) => a.status === "confirmed" && a.start > t && a.start < t + 7 * 86400_000 && (companyWide || a.memberId === me.id));
  const openOpps = s.opps.filter((o) => (companyWide || o.ownerId === me.id) && s.pipelines.find((p) => p.id === o.pipelineId)?.stages.find((x) => x.id === o.stageId)?.kind === "open");
  const byStage = s.pipelines.flatMap((p) => p.stages.filter((st) => st.kind === "open").map((st) => ({ key: st.id, label: `${p.name} · ${st.name}`, count: openOpps.filter((o) => o.stageId === st.id).length, value: openOpps.filter((o) => o.stageId === st.id).reduce((a, o) => a + o.value, 0) }))).filter((r) => r.count);
  const max = Math.max(1, ...byStage.map((r) => r.value));
  const avail = (["available", "busy", "leave", "offline"] as const).map((k) => ({ k, n: s.members.filter((m) => m.status === k).length }));

  return (
    <>
      <PageHeader title={companyWide ? "Operations overview" : "My day"} sub={companyWide ? "Live company-wide figures. Click a figure to see the records behind it." : "Your own leads and response times."}
        actions={<Button variant="secondary" size="sm" onClick={() => setCust(!cust)} aria-expanded={cust}><SlidersHorizontal size={14} />Customize</Button>} />
      {cust && (
        <Card className="mb-4"><p className="mb-2 text-sm font-medium">Show or hide figures</p>
          <div className="flex flex-wrap gap-3">{TILES.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={show(k)} onChange={() => toggleTile(k)} className="size-4 accent-[var(--brand)]" />{label}</label>))}</div></Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {show("newToday") && <Stat label="New leads today" value={newToday} href="/leads?tab=all&today=1" />}
        {show("ttfr") && <Stat label="Avg. time to first response" value={avg === null ? "—" : fmtDur(avg)} sub={`${acked.length} acknowledged leads`} href="/leads?tab=all" />}
        {show("recovery") && <Stat label="Recovery queue" value={<span className={rec ? "text-bad" : ""}>{rec}</span>} sub="Leads needing attention" href="/leads?tab=recovery" />}
        {show("esc") && <Stat label="Escalations (24h)" value={esc} sub="Automatic only" href="/audit" />}
        {show("collected") && <Stat label="Collected this month" value={mask(seeVal, money(collected))} sub={seeVal ? `${money(pays.filter((p) => p.status === "pending").reduce((a, p) => a + p.amount, 0))} projected (unpaid)` : "Requires value permission"} href="/payments" />}
        {show("appts") && <Stat label="Upcoming appointments" value={appts.length} sub="Next 7 days" href="/calendar" />}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {show("pipeline") && (
          <Card className="lg:col-span-2"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Open pipeline value by stage</h2><Link className="text-xs text-brand underline" href="/pipeline">Open board</Link></div>
            {byStage.length === 0 ? <p className="text-sm text-muted">No open opportunities.</p> : (
              <ul className="space-y-2.5">{byStage.map((r) => (
                <li key={r.key} className="text-sm"><div className="mb-1 flex justify-between gap-2"><span>{r.label} <span className="text-muted">({r.count})</span></span><span className="tabular-nums font-medium">{mask(seeVal, money(r.value))}</span></div>
                  <div className="h-2 rounded-full bg-surface2" role="presentation"><div className="h-2 rounded-full bg-brand" style={{ width: seeVal ? `${(r.value / max) * 100}%` : `${(r.count / Math.max(1, ...byStage.map((x) => x.count))) * 100}%` }} /></div></li>))}</ul>)}
          </Card>
        )}
        {show("team") && (
          <Card><h2 className="mb-3 font-semibold">Employee availability</h2>
            <div className="mb-3 flex flex-wrap gap-2">{avail.map((a) => <Badge key={a.k} tone={a.k === "available" ? "ok" : a.k === "busy" ? "warn" : "neutral"}>{a.n} {a.k === "leave" ? "on leave" : a.k}</Badge>)}</div>
            <ul className="space-y-1.5 text-sm">{(companyWide ? s.members : [me]).map((m) => (
              <li key={m.id} className="flex items-center justify-between"><span>{m.name}</span><Badge tone={m.status === "available" ? "ok" : m.status === "busy" ? "warn" : "neutral"}>{m.status === "leave" ? "on leave" : m.status}</Badge></li>))}</ul>
          </Card>
        )}
      </div>
    </>
  );
}
