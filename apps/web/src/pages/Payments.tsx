import { Link } from "react-router-dom";
import { Copy } from "lucide-react";
import { useApp, mask } from "@/lib/app";
import { nameOf, paymentEvent } from "@/lib/store";
import { ago, money } from "@/lib/utils";
import { Badge, Button, Card, Empty, PageHeader, Select, Stat, toast } from "@/components/ui";

const tone = { paid: "ok", pending: "warn", failed: "bad", expired: "bad", refunded: "neutral" } as const;
export default function Payments() {
  const { s, me, can, companyWide } = useApp(); if (!me) return null;
  const v = can("value.view"); const list = s.payments.filter((p) => companyWide || p.requestedBy === me.id);
  const collected = list.filter((p) => p.status === "paid").reduce((a, p) => a + p.amount, 0);
  const projected = list.filter((p) => p.status === "pending").reduce((a, p) => a + p.amount, 0);
  const refunded = list.filter((p) => p.status === "refunded").reduce((a, p) => a + p.amount, 0);
  return (
    <>
      <PageHeader title="Payments" sub="Collected revenue counts only payments confirmed by Stripe's webhook, minus refunds." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3"><Stat label="Collected" value={mask(v, money(collected))} /><Stat label="Projected (unpaid requests)" value={mask(v, money(projected))} /><Stat label="Refunded" value={mask(v, money(refunded))} /></div>
      {list.length === 0 ? <Empty title="No payment requests" hint="Request a payment from an opportunity on a contact page." /> : (
        <ul className="space-y-2">{list.map((p) => {
          const o = s.opps.find((x) => x.id === p.oppId); const c = s.contacts.find((x) => x.id === p.contactId);
          return (
            <li key={p.id}><Card className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-medium tabular-nums">{mask(v, money(p.amount, p.currency))} <Badge tone={tone[p.status]}>{p.status}</Badge></p>
                <p className="text-sm text-muted"><Link className="hover:underline" to={`/contacts/${p.contactId}`}>{c?.name}</Link> · {o?.title} · requested by {nameOf(s, p.requestedBy)} · {ago(p.at)}</p>
                <p className="font-mono text-xs text-muted">{p.ref}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(p.link); toast("Link copied.", "ok"); }}><Copy size={13} />Copy link</Button>
                {can("integrations.manage") && <Select aria-label={`Simulate webhook for ${p.ref}`} value="" onChange={(e) => { if (e.target.value) paymentEvent(p.id, e.target.value as "paid"); }} className="!w-auto !py-1.5 !text-xs"><option value="">Simulate webhook…</option><option value="paid">checkout.completed (paid)</option><option value="failed">payment failed</option><option value="expired">session expired</option><option value="refunded">refund</option></Select>}
              </div></Card></li>);
        })}</ul>)}
    </>
  );
}
