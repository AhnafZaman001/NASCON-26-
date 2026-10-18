import { useState } from "react";
import { useApp } from "@/lib/app";
import { requestPayment } from "@/lib/store";
import { Button, Field, Input, Modal, Select, toast } from "./ui";

export default function RequestPayment({ oppId, onClose }: { oppId: string | null; onClose: () => void }) {
  const { s } = useApp(); const [amount, setAmount] = useState(""); const [cur, setCur] = useState("USD"); const [err, setErr] = useState("");
  const connected = s.integrations.payments.status === "connected";
  return (
    <Modal open={!!oppId} onClose={onClose} title="Request payment">
      {!connected ? <p role="alert" className="text-sm text-bad">Payments aren&apos;t connected. An admin can connect Stripe on the Integrations page.</p> : (
        <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); const n = Number(amount); if (!(n > 0)) { setErr("Enter an amount greater than zero."); return; } requestPayment(oppId!, n, cur); setAmount(""); setErr(""); onClose(); toast("Checkout link created. Share it with the customer.", "ok"); }}>
          <Field label="Amount" error={err}>{(id) => <Input id={id} type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Currency">{(id) => <Select id={id} value={cur} onChange={(e) => setCur(e.target.value)}><option>USD</option><option>PKR</option><option>EUR</option></Select>}</Field>
          <p className="text-xs text-muted">Card details are entered only on Stripe&apos;s hosted page. They never touch this app.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">Create link</Button></div>
        </form>)}
    </Modal>
  );
}
