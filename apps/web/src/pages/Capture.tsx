import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useApp } from "@/lib/app";
import { captureLead } from "@/lib/store";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";

/**
 * Public lead form (F3.1). /capture?w=<workspace id> works for anyone (no login) and posts to the
 * API's public endpoint; without ?w it feeds the workspace you're signed in to (or the demo).
 */
export default function Capture() {
  const { s } = useApp();
  const [params] = useSearchParams();
  const wsId = params.get("w");
  const [wsName, setWsName] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", phone: "", email: "", note: "", website: "" });
  const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!wsId) return;
    fetch(`/api/public/workspaces/${wsId}`).then((r) => r.json()).then((j) => setWsName(j.name ?? null)).catch(() => {});
  }, [wsId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); const er: Record<string, string> = {};
    if (!f.name.trim()) er.name = "Please tell us your name.";
    if (!/^\+?[0-9 ()-]{7,}$/.test(f.phone)) er.phone = "Enter a phone number with country code, e.g. +92 300 1234567.";
    setErr(er); if (Object.keys(er).length) return;
    const phone = f.phone.replace(/[ ()-]/g, "");
    if (!wsId) { captureLead(f.name.trim(), phone, f.email.trim(), f.note.trim()); setDone(true); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/public/capture/${wsId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: f.name.trim(), phone, email: f.email.trim(), note: f.note.trim(), website: f.website }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr({ form: j.error ?? "Something went wrong. Please try again." }); return; }
      setDone(true);
    } catch { setErr({ form: "Can't reach the server. Check your connection and try again." }); }
    finally { setBusy(false); }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const company = wsId ? wsName : s.workspace.name;
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-md">
        <h1 className="text-xl font-semibold">Talk to {company || "us"}</h1>
        <p className="mb-4 text-sm text-muted">Leave your details and a specialist will reply shortly.</p>
        {done ? <p role="status" className="rounded-lg bg-ok/15 p-3 text-sm text-ok">Thanks, we&apos;ve got your request and someone is on it now.</p> : (
          <form onSubmit={submit} className="space-y-3" noValidate aria-busy={busy}>
            <Field label="Name" error={err.name}>{(id) => <Input id={id} autoComplete="name" value={f.name} onChange={set("name")} />}</Field>
            <Field label="Phone / WhatsApp" error={err.phone}>{(id) => <Input id={id} type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} />}</Field>
            <Field label="Email (optional)">{(id) => <Input id={id} type="email" autoComplete="email" value={f.email} onChange={set("email")} />}</Field>
            <Field label="What do you need?">{(id) => <Textarea id={id} rows={3} value={f.note} onChange={set("note")} />}</Field>
            {/* honeypot: hidden from people, bots fill it */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={f.website} onChange={set("website")} />
            {err.form && <p role="alert" className="text-sm text-bad">{err.form}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Sending…" : "Send"}</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
