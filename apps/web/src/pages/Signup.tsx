import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { signup } from "@/lib/store";
import { Button, Card, Field, Input } from "@/components/ui";

export default function Signup() {
  const r = useNavigate();
  const [f, setF] = useState({ company: "", name: "", email: "", pw: "" }); const [err, setErr] = useState<Record<string, string>>({});
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); const er: Record<string, string> = {};
    if (!f.company.trim()) er.company = "Enter your company name.";
    if (!f.name.trim()) er.name = "Enter your name.";
    if (!/^\S+@\S+\.\S+$/.test(f.email)) er.email = "Enter a valid email address.";
    if (f.pw.length < 8) er.pw = "Use at least 8 characters.";
    setErr(er); if (Object.keys(er).length) return;
    signup(f.company.trim(), f.name.trim(), f.email.trim()); r("/dashboard", { replace: true });
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center"><h1 className="text-2xl font-bold tracking-tight">Create your workspace</h1><p className="text-sm text-muted">You&apos;ll be the Owner. Invite your team afterwards.</p></div>
        <Card>
          <form onSubmit={submit} className="space-y-3" noValidate>
            <Field label="Company name" error={err.company}>{(id) => <Input id={id} value={f.company} onChange={set("company")} />}</Field>
            <Field label="Your name" error={err.name}>{(id) => <Input id={id} autoComplete="name" value={f.name} onChange={set("name")} />}</Field>
            <Field label="Work email" error={err.email}>{(id) => <Input id={id} type="email" autoComplete="email" value={f.email} onChange={set("email")} />}</Field>
            <Field label="Password" hint="At least 8 characters." error={err.pw}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={f.pw} onChange={set("pw")} />}</Field>
            <Button type="submit" className="w-full">Create workspace</Button>
          </form>
          <p className="mt-3 text-center text-sm text-muted">Have an account? <Link to="/login" className="font-medium text-brand underline">Log in</Link></p>
        </Card>
      </div>
    </div>
  );
}
