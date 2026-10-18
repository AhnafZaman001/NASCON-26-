import { useEffect, useId, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { X } from "lucide-react";
import { Link } from "react-router-dom";
import { cn, initials, mmss } from "@/lib/utils";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" };
export function Button({ variant = "primary", size = "md", className, ...p }: BtnProps) {
  const v = { primary: "bg-brand text-brandfg hover:opacity-90", secondary: "bg-surface2 text-fg border border-line hover:bg-line/50", ghost: "text-fg hover:bg-surface2", danger: "bg-bad text-white hover:opacity-90" }[variant];
  return <button {...p} className={cn("inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50", size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm", v, className)} />;
}
export const Card = ({ className, children }: { className?: string; children: ReactNode }) => <div className={cn("rounded-xl border border-line bg-surface p-4", className)}>{children}</div>;
const tones = { neutral: "bg-surface2 text-muted", brand: "bg-brand/15 text-brand", ok: "bg-ok/15 text-ok", warn: "bg-warn/15 text-warn", bad: "bg-bad/15 text-bad" };
export const Badge = ({ tone = "neutral", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) =>
  <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted disabled:opacity-60";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cn(field, p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cn(field, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cn(field, p.className)} />;
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">{label}</label>
      {children(id)}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
    </div>
  );
}
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label={title} className="m-auto w-[min(32rem,calc(100vw-1.5rem))] rounded-xl border border-line bg-surface p-0">
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} aria-label="Close dialog" className="rounded p-1 hover:bg-surface2"><X size={18} /></button></div>
          {children}
        </div>
      )}
    </dialog>
  );
}
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 rounded-lg bg-surface2 p-1">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
          className={cn("rounded-md px-3 py-1.5 text-sm font-medium", value === t.key ? "bg-surface shadow-sm" : "text-muted hover:text-fg")}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
export const PageHeader = ({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div><h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>{sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}</div>
    <div className="flex flex-wrap gap-2">{actions}</div>
  </div>
);
export const Empty = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="rounded-xl border border-dashed border-line p-8 text-center"><p className="font-medium">{title}</p>{hint && <p className="mt-1 text-sm text-muted">{hint}</p>}</div>
);
export const Avatar = ({ name, className }: { name: string; className?: string }) => (
  <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand", className)}>{initials(name)}</span>
);
export function Stat({ label, value, sub, href }: { label: string; value: ReactNode; sub?: string; href?: string }) {
  const inner = (<><p className="text-xs font-medium text-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</>);
  return href ? <Link to={href} className="block rounded-xl border border-line bg-surface p-4 transition hover:border-brand">{inner}</Link> : <Card>{inner}</Card>;
}

/* live clock */
export function useNow(ms = 1000) {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setN(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return n;
}
export function Countdown({ deadline }: { deadline: number }) {
  const left = deadline - useNow(500);
  const urgent = left < 10_000;
  return <Badge tone={left <= 0 ? "bad" : urgent ? "warn" : "brand"} className={urgent ? "pulse" : ""}><span className="sr-only">Time left to acknowledge: </span>{left <= 0 ? "Escalating…" : mmss(left)}</Badge>;
}

/* toasts */
type T = { id: number; msg: string; tone: "ok" | "bad" | "info" };
let toasts: T[] = []; const tl = new Set<() => void>();
export function toast(msg: string, tone: T["tone"] = "info") {
  const t = { id: Date.now() + Math.random(), msg, tone }; toasts = [...toasts, t].slice(-4); tl.forEach((l) => l());
  setTimeout(() => { toasts = toasts.filter((x) => x !== t); tl.forEach((l) => l()); }, 4500);
}
export function ToastHost() {
  const list = useSyncExternalStore((l) => { tl.add(l); return () => { tl.delete(l); }; }, () => toasts, () => []);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {list.map((t) => (
        <div key={t.id} className={cn("pointer-events-auto rounded-lg border bg-surface p-3 text-sm shadow-lg", t.tone === "ok" ? "border-ok" : t.tone === "bad" ? "border-bad" : "border-line")}>
          <span className="font-medium">{t.tone === "ok" ? "Done. " : t.tone === "bad" ? "Problem. " : ""}</span>{t.msg}
        </div>
      ))}
    </div>
  );
}
