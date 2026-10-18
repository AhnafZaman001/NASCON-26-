import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useApp } from "@/lib/app";
import { loginAs, loginWithPassword, resetDemo } from "@/lib/store";
import { Button, Card, Field, Input } from "@/components/ui";

export default function Login() {
  const { s } = useApp(); const r = useNavigate();
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState("");
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (loginWithPassword(email, pw)) r("/dashboard", { replace: true }); else setErr("That email and password don't match. For the demo, the password is demo1234."); };
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center"><h1 className="text-2xl font-bold tracking-tight">Lead Shield</h1><p className="text-sm text-muted">Every lead gets an owner. Every action leaves a trail.</p></div>
        <Card>
          <form onSubmit={submit} className="space-y-3" noValidate>
            <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Field label="Password" error={err || undefined}>{(id) => <Input id={id} type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
            <Button type="submit" className="w-full">Log in</Button>
          </form>
          <p className="mt-3 text-center text-sm text-muted">New company? <Link to="/signup" className="font-medium text-brand underline">Create a workspace</Link></p>
        </Card>
        <Card>
          <p className="mb-2 text-sm font-medium">Demo accounts ({s.workspace.name || "Skyline Realty"})</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {s.members.map((m) => <Button key={m.id} variant="secondary" size="sm" className="justify-start" onClick={() => { loginAs(m.id); r("/dashboard", { replace: true }); }}>{m.name}<span className="ml-auto text-muted">{m.roleName}</span></Button>)}
          </div>
          <button className="mt-3 text-xs text-muted underline" onClick={resetDemo}>Reset demo data</button>
        </Card>
      </div>
    </div>
  );
}
