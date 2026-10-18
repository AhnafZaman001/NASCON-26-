import { Link } from "react-router-dom";
import { useState } from "react";
import { useApp, canSeeContact } from "@/lib/app";
import { nameOf, simulateDuplicateWebhook, simulateForgedWebhook, simulateIncoming } from "@/lib/store";
import { ago } from "@/lib/utils";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, toast } from "@/components/ui";

export default function Inbox() {
  const { s, me, can } = useApp(); const [phone, setPhone] = useState("+923009990001"); const [body, setBody] = useState("Hi, I'd like to know about your listings.");
  if (!me) return null;
  const threads = s.contacts.map((c) => ({ c, msgs: s.messages.filter((m) => m.contactId === c.id) })).filter((t) => t.msgs.length && canSeeContact(s, me.id, can("crm.view"), t.c.id))
    .map((t) => ({ ...t, last: t.msgs.reduce((a, b) => (a.at > b.at ? a : b)), lead: s.leads.find((l) => l.contactId === t.c.id) })).sort((a, b) => b.last.at - a.last.at);
  return (
    <>
      <PageHeader title="Inbox" sub="WhatsApp conversations, newest first. Only conversations you're allowed to see are listed." />
      {threads.length === 0 ? <Empty title="No conversations yet" hint="Messages sent to the sandbox number land here." /> : (
        <ul className="mb-6 space-y-2">{threads.map(({ c, last, lead }) => (
          <li key={c.id}><Link to={`/contacts/${c.id}`} className="block"><Card className="flex flex-wrap items-center justify-between gap-2 transition hover:border-brand">
            <div className="min-w-0"><p className="font-medium">{c.name}{c.optedOut && <Badge tone="bad" className="ml-2">opted out</Badge>}</p>
              <p className="truncate text-sm text-muted">{last.direction === "out" ? "You: " : ""}{last.body}</p></div>
            <div className="flex items-center gap-2 text-xs text-muted">{last.status === "failed" && <Badge tone="bad">failed</Badge>}<span>Assigned: {nameOf(s, lead?.ownerId)}</span><span>{ago(last.at)}</span></div></Card></Link></li>))}</ul>)}
      <Card>
        <h2 className="font-semibold">Webhook simulator (demo only)</h2>
        <p className="mb-3 text-sm text-muted">Stands in for Twilio&apos;s webhook until the backend endpoint is connected. An unknown number creates a contact and a lead; a duplicate delivery is ignored.</p>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="From number">{(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field><Field label="Message">{(id) => <Input id={id} value={body} onChange={(e) => setBody(e.target.value)} />}</Field></div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => { simulateIncoming(phone.trim(), body); toast("Incoming message received.", "ok"); }}>Receive message</Button>
          <Button variant="secondary" onClick={() => { simulateDuplicateWebhook(phone.trim()); toast("Sent the same webhook twice. See Integrations > history.", "info"); }}>Deliver same webhook twice</Button>
          <Button variant="secondary" onClick={() => { simulateForgedWebhook(); toast("Forged request rejected and logged.", "info"); }}>Send forged webhook</Button></div>
      </Card>
    </>
  );
}
