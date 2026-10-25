import { useEffect, useState } from "react";
import { useApp } from "@/lib/app";
import { requestPayment } from "@/lib/store";
import { Button, Field, Input, Modal, Select, toast } from "./ui";

export default function RequestPayment({ oppId, onClose, chooseOpportunity = false }: { oppId: string | null; onClose: () => void; chooseOpportunity?: boolean }) {
  const { s, can } = useApp();
  const [amount, setAmount] = useState(""); const [cur, setCur] = useState("USD");
  const [selected, setSelected] = useState(""); const [err, setErr] = useState(""); const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const open = !!oppId || chooseOpportunity;
  const initialCurrency = s.opps.find((o) => o.id === oppId)?.currency?.toUpperCase() ?? "USD";
  const permitted = can("crm.edit") && can("values.view");
  const opportunity = oppId ?? selected;
  useEffect(() => {
    if (!open) return;
    setAmount(""); setSelected(""); setErr(""); setFields({});
    setCur(initialCurrency);
  }, [open, oppId, initialCurrency]);

  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title="Create demo payment">
      {!permitted ? (
        <p role="alert" className="text-sm text-bad">Creating payment requests requires CRM edit and value-view permissions.</p>
      ) : (
        <form noValidate className="space-y-3" aria-busy={busy} onSubmit={async (e) => {
          e.preventDefault(); if (busy) return;
          const n = Number(amount);
          if (!opportunity) { setErr("Choose an opportunity."); return; }
          if (!Number.isFinite(n) || !(n > 0)) { setErr("Enter an amount greater than zero."); return; }
          setBusy(true); setErr(""); setFields({});
          const result = await requestPayment(opportunity, n, cur);
          setBusy(false);
          if (!result.ok) { setErr(result.error ?? "Could not create the Checkout link."); setFields(result.fields ?? {}); return; }
          onClose(); toast("Demo payment created.", "ok");
        }}>
          {chooseOpportunity && <Field label="Opportunity" error={fields.opportunityId}>{(id) => <Select id={id} value={selected} disabled={busy} onChange={(e) => { setSelected(e.target.value); setCur(s.opps.find((o) => o.id === e.target.value)?.currency?.toUpperCase() ?? "USD"); }}><option value="">Choose an opportunity…</option>{s.opps.filter((o) => !o.valueHidden).map((o) => <option key={o.id} value={o.id}>{o.title} · {s.contacts.find((c) => c.id === o.contactId)?.name ?? "Contact"}</option>)}</Select>}</Field>}
          <Field label="Amount" error={fields.amount}>{(id) => <Input id={id} type="number" min={cur === "JPY" ? "1" : "0.01"} step={cur === "JPY" ? "1" : "0.01"} value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Currency" error={fields.currency}>{(id) => <Select id={id} value={cur} disabled={busy} onChange={(e) => setCur(e.target.value)}>{[...new Set(["USD", "PKR", "EUR", "GBP", "JPY", cur])].map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
          {err && <p role="alert" className="text-sm text-bad">{err}</p>}
          <p className="text-xs text-muted">Simulation only. No card details, merchant account, or real charges. Saved in this browser only.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !opportunity}>{busy ? "Creating link…" : "Create link"}</Button></div>
        </form>)}
    </Modal>
  );
}
