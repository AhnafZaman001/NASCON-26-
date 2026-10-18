import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useApp } from "@/lib/app";
import { loginAs, resetDemo, signIn } from "@/lib/store";
import { Button, Card, Field, Input } from "@/components/ui";

export default function Login() {
  const { s } = useApp(); const r = useNavigate();
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    if (!/^\S+@\S+\.\S+$/.test(email) || !pw) { setErr("Enter your email and password."); return; }
    setBusy(true);
    const res = await signIn(email, pw);
    setBusy(false);
    if (res.ok) r("/dashboard", { replace: true }); else setErr(res.error ?? "Could not sign in.");
  };
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center"><h1 className="text-2xl font-bold tracking-tight">Lead Shield</h1><p className="text-sm text-muted">Every lead gets an owner. Every action leaves a trail.</p></div>
        <Card>
          <form onSubmit={submit} className="space-y-3" noValidate aria-busy={busy}>
            <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Field label="Password" error={err || undefined}>{(id) => <Input id={id} type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Log in"}</Button>
          </form>
          <p className="mt-3 text-center text-sm text-muted">New company? <Link to="/signup" className="font-medium text-brand underline">Create a workspace</Link></p>
        </Card>
        {s.mode === "demo" && s.members.length > 0 && (
          <Card>
            <p className="text-sm font-medium">Explore the demo workspace ({s.workspace.name || "Skyline Realty"})</p>
            <p className="mb-2 text-xs text-muted">Sample data kept only in this browser. No account needed.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {s.members.map((m) => <Button key={m.id} variant="secondary" size="sm" className="justify-start" onClick={() => { loginAs(m.id); r("/dashboard", { replace: true }); }}>{m.name}<span className="ml-auto text-muted">{m.roleName}</span></Button>)}
            </div>
            <button className="mt-3 text-xs text-muted underline" onClick={resetDemo}>Reset demo data</button>
          </Card>
        )}
      </div>
    </div>
  );
}
