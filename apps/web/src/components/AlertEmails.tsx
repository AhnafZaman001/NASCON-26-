import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ago } from "@/lib/utils";
import { Badge, Button, Card, Empty, toast } from "@/components/ui";

// I4.4: recent alert emails with status and failure reason. Admins (integrations.manage) see the whole
// workspace and can press "Send now"; everyone else sees only their own alerts.
type Row = { id: string; to_email: string; subject: string; status: "pending" | "sending" | "sent" | "failed"; attempts: number; max_attempts: number; last_error: string | null; created_at: string };
const tone = { sent: "ok", failed: "bad", pending: "warn", sending: "neutral" } as const;

export default function AlertEmails({ canSend }: { canSend: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRows((await api<{ emails: Row[] }>("/emails")).emails); } catch { setRows([]); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  const sendNow = async () => {
    setBusy(true);
    try {
      const r = await api<{ sent: number; retrying: number; failed: number; skipped?: string }>("/emails/send", { method: "POST" });
      toast(r.skipped ?? `Sent ${r.sent}, retrying ${r.retrying}, failed ${r.failed}.`, r.skipped || r.failed ? "bad" : "ok");
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not send.", "bad"); }
    finally { setBusy(false); }
  };

  return (
    <Card className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">Alert emails</h2>
        {canSend && <Button size="sm" variant="secondary" onClick={sendNow} disabled={busy}>{busy ? "Sending…" : "Send now"}</Button>}
      </div>
      {rows === null ? <p className="text-sm text-muted">Loading…</p> : rows.length === 0 ? (
        <Empty title="No alert emails yet" hint="When a lead is assigned or escalated, the new owner is emailed and the result shows here." />
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="w-24 text-xs text-muted">{ago(Date.parse(r.created_at))}</span>
              <Badge tone={tone[r.status]}>{r.status}</Badge>
              <span className="min-w-0 flex-1 truncate">{r.subject} <span className="text-muted">→ {r.to_email}</span></span>
              {r.last_error && <span className="w-full text-xs text-bad" title={r.last_error}>Attempt {r.attempts}/{r.max_attempts}: {r.last_error}</span>}
            </li>))}
        </ul>)}
    </Card>
  );
}
