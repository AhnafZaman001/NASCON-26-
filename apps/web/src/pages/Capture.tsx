import { useState } from "react";
import { useApp } from "@/lib/app";
import { captureLead } from "@/lib/store";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";

/** Public lead form (F3.1). Embeddable by the customer's website; no login. */
export default function Capture() {
  const { s } = useApp();
  const [f, setF] = useState({ name: "", phone: "", email: "", note: "" }); const [done, setDone] = useState(false); const [err, setErr] = useState<Record<string, string>>({});
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); const er: Record<string, string> = {};
    if (!f.name.trim()) er.name = "Please tell us your name.";
    if (!/^\+?[0-9 ()-]{7,}$/.test(f.phone)) er.phone = "Enter a phone number with country code, e.g. +92 300 1234567.";
    setErr(er); if (Object.keys(er).length) return;
    captureLead(f.name.trim(), f.phone.replace(/[ ()-]/g, ""), f.email.trim(), f.note.trim()); setDone(true);
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-md">
        <h1 className="text-xl font-semibold">Talk to {s.workspace.name || "us"}</h1>
        <p className="mb-4 text-sm text-muted">Leave your details and a specialist will reply shortly.</p>
        {done ? <p role="status" className="rounded-lg bg-ok/15 p-3 text-sm text-ok">Thanks, we&apos;ve got your request and someone is on it now.</p> : (
          <form onSubmit={submit} className="space-y-3" noValidate>
            <Field label="Name" error={err.name}>{(id) => <Input id={id} value={f.name} onChange={set("name")} />}</Field>
            <Field label="Phone / WhatsApp" error={err.phone}>{(id) => <Input id={id} type="tel" value={f.phone} onChange={set("phone")} />}</Field>
            <Field label="Email (optional)">{(id) => <Input id={id} type="email" value={f.email} onChange={set("email")} />}</Field>
            <Field label="What do you need?">{(id) => <Textarea id={id} rows={3} value={f.note} onChange={set("note")} />}</Field>
            <Button type="submit" className="w-full">Send</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
