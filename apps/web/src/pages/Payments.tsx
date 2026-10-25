import { useState } from "react";
import { Link } from "react-router-dom";
import { Copy, ExternalLink, Plus } from "lucide-react";
import { useApp, mask } from "@/lib/app";
import { nameOf, paymentEvent } from "@/lib/store";
import { collectedPayment, paymentMoney } from "@/lib/payments";
import { ago } from "@/lib/utils";
import type { PaymentTotal } from "@/lib/types";
import RequestPayment from "@/components/RequestPayment";
import { Badge, Button, Card, Empty, PageHeader, Select, Stat, toast } from "@/components/ui";

const tone = { paid: "ok", pending: "warn", failed: "bad", expired: "bad", refunded: "neutral", partially_refunded: "warn" } as const;
export default function Payments() {
  const { s, me, can, companyWide } = useApp();
  const [creating, setCreating] = useState(false);
  const values = can("values.view");
  if (!me) return null;
  const list = s.payments.filter((p) => companyWide || p.requestedBy === me.id);
  let totals: PaymentTotal[] = s.paymentTotals ?? [];
  {
    const map = new Map<string, { currency: string; collected: number; projected: number; refunded: number }>();
    const get = (currency: string) => { const key = currency.toUpperCase(); if (!map.has(key)) map.set(key, { currency: key, collected: 0, projected: 0, refunded: 0 }); return map.get(key)!; };
    for (const p of list) { const t = get(p.currency); t.collected += collectedPayment(p); t.refunded += p.refundedAmount ?? (p.status === "refunded" ? p.amount : 0); if (p.status === "pending") t.projected += p.amount; }
    for (const o of s.opps) { const stage = s.pipelines.find((p) => p.id === o.pipelineId)?.stages.find((st) => st.id === o.stageId); if (stage?.kind === "open" && (companyWide || o.ownerId === me.id)) get(o.currency ?? "USD").projected += o.value; }
    totals = [...map.values()];
  }
  const metric = (key: "collected" | "projected" | "refunded") => !values ? "••••" : totals.length ? totals.map((t) => t[key] === null ? "••••" : paymentMoney(t[key]!, t.currency)).join(" · ") : "—";
  const copy = async (link: string) => {
    try { await navigator.clipboard.writeText(link); toast("Checkout link copied.", "ok"); }
    catch { toast("Could not copy. Open demo and copy the address from your browser.", "bad"); }
  };
  return (
    <>
      <PageHeader title="Payments · Demo" sub="No money moves. Requests and results are saved in this browser, not shared with your team."
        actions={can("crm.edit") && values && <Button size="sm" onClick={() => setCreating(true)}><Plus size={14} />Create demo payment</Button>} />
      <div className="mb-2 grid gap-3 sm:grid-cols-3"><Stat label="Collected (net of refunds)" value={metric("collected")} /><Stat label="Projected (open deals + unpaid requests)" value={metric("projected")} /><Stat label="Refunded" value={metric("refunded")} /></div>
      {totals.length > 1 && <p className="mb-4 text-xs text-muted">Totals are shown separately for each currency.</p>}
      {list.length === 0 ? <Empty title="No payment requests" hint="Create a demo request, then simulate payment, failure, expiry or a refund." /> : (
        <ul className="mt-4 space-y-2">{list.map((p) => {
          const o = s.opps.find((x) => x.id === p.oppId); const c = s.contacts.find((x) => x.id === p.contactId);
          return <li key={p.id}><Card className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0"><p className="font-medium tabular-nums">{mask(values && !p.amountHidden, paymentMoney(p.amount, p.currency))} <Badge tone={tone[p.status]}>{p.status.replaceAll("_", " ")}</Badge></p>
              <p className="text-sm text-muted"><Link className="hover:underline" to={`/contacts/${p.contactId}`}>{p.contactName ?? c?.name ?? "Contact"}</Link> · {p.opportunityTitle ?? o?.title ?? "Opportunity"} · requested by {p.requesterName ?? nameOf(s, p.requestedBy)} · {ago(p.at)}</p>
              {(p.refundedAmount ?? 0) > 0 && <p className="text-xs text-muted">Refunded {mask(values && !p.amountHidden, paymentMoney(p.refundedAmount!, p.currency))}; collected {mask(values && !p.amountHidden, paymentMoney(collectedPayment(p), p.currency))}</p>}
              <p className="break-all font-mono text-xs text-muted">Demo reference: {p.ref || "Not created"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {p.link && p.ref.startsWith("demo_") && values && <><a href={p.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium"><ExternalLink size={13} />Open demo</a><Button size="sm" variant="ghost" onClick={() => void copy(p.link)}><Copy size={13} />Copy link</Button></>}

              {can("crm.edit") && values && <Select aria-label={`Simulate webhook for ${p.ref}`} value="" onChange={(e) => { if (e.target.value) paymentEvent(p.id, e.target.value as "paid"); }} className="!w-auto !py-1.5 !text-xs"><option value="">Simulate result…</option>{p.status === "pending" && <><option value="paid">Payment succeeds</option><option value="failed">Payment fails</option><option value="expired">Request expires</option></>}{["paid", "partially_refunded"].includes(p.status) && <><option value="refunded">Full refund</option>{p.status === "paid" && <option value="partially_refunded">50% refund</option>}</>}</Select>}
            </div>
          </Card></li>;
        })}</ul>)}
      <RequestPayment oppId={null} chooseOpportunity={creating} onClose={() => setCreating(false)} />
    </>
  );
}
