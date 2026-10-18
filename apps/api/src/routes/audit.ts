import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase.ts";
import { must, parse } from "../lib/http.ts";
import { ctxOf, requireMember, requirePerm } from "../middleware/auth.ts";

// M5 / F4.2: read-only audit history for users with audit.view. There is deliberately no
// write, edit or delete route here (F4.3); the table itself rejects UPDATE/DELETE/TRUNCATE.
export const audit = Router();
audit.use(requireMember, requirePerm("audit.view"));

type Row = {
  id: number; created_at: string; actor_id: string | null; actor_type: "user" | "system";
  event_type: string; target_type: string | null; target_id: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
};

const Query = z.object({
  type: z.string().max(80).optional(),
  actor: z.union([z.literal("system"), z.string().uuid()]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  cursor: z.coerce.number().int().positive().optional(),   // id of the last row already shown
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Columns that change on every write and say nothing to a reader.
const NOISE = new Set(["id", "workspace_id", "created_at", "updated_at", "version"]);

const short = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map(short).join(", ") : "none";
  if (typeof v === "object") { const s = JSON.stringify(v); return s.length > 120 ? s.slice(0, 117) + "…" : s; }
  return String(v);
};

/** Changed fields only (before -> after); for inserts/deletes, the record's main fields. */
function changes(before: Row["before"], after: Row["after"]) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: { key: string; before: string; after: string }[] = [];
  for (const k of keys) {
    if (NOISE.has(k)) continue;
    const b = before?.[k], a = after?.[k];
    if (before && after && JSON.stringify(b) === JSON.stringify(a)) continue;
    out.push({ key: k, before: before ? short(b) : "", after: after ? short(a) : "" });
  }
  return out.slice(0, 12);
}

/** A readable name for what was changed, taken from the record itself when it has one. */
function targetLabel(r: Row) {
  const rec = (r.after ?? r.before ?? {}) as Record<string, unknown>;
  const name = rec.full_name ?? rec.name ?? rec.title ?? rec.email ?? rec.provider;
  if (typeof name === "string" && name) return name;
  return r.target_id ? `${r.target_type ?? "record"} ${r.target_id.slice(0, 8)}` : r.target_type ?? "";
}

audit.get("/", async (req, res) => {
  const { member } = ctxOf(req);
  const f = parse(Query, req.query);
  const db = supabaseAdmin();

  let q = db.from("audit_log")
    .select("id, created_at, actor_id, actor_type, event_type, target_type, target_id, before, after")
    .eq("workspace_id", member.workspaceId)
    .order("id", { ascending: false })
    .limit(f.limit + 1);   // one extra row tells us whether there is a next page
  if (f.type) q = q.eq("event_type", f.type);
  if (f.actor === "system") q = q.eq("actor_type", "system");
  else if (f.actor) q = q.eq("actor_id", f.actor);
  if (f.from) q = q.gte("created_at", f.from);
  if (f.to) q = q.lte("created_at", f.to);
  if (f.cursor) q = q.lt("id", f.cursor);

  const [rows, members] = await Promise.all([
    q,
    db.from("members").select("id, full_name, email").eq("workspace_id", member.workspaceId),
  ]);
  const list = must(rows) as Row[];
  const names = new Map((must(members) as { id: string; full_name: string; email: string }[]).map((m) => [m.id, m.full_name || m.email]));
  const page = list.slice(0, f.limit);

  res.json({
    items: page.map((r) => ({
      id: r.id,
      at: r.created_at,
      actorId: r.actor_id,
      actor: r.actor_type === "system" || !r.actor_id ? "System" : names.get(r.actor_id) ?? "Former member",
      type: r.event_type,
      targetType: r.target_type,
      target: targetLabel(r),
      changes: changes(r.before, r.after),
    })),
    nextCursor: list.length > f.limit ? page[page.length - 1].id : null,
  });
});

// Event types present in this workspace's log, for the filter dropdown.
audit.get("/types", async (req, res) => {
  const { member } = ctxOf(req);
  const rows = must(await supabaseAdmin().from("audit_log").select("event_type")
    .eq("workspace_id", member.workspaceId).order("id", { ascending: false }).limit(2000)) as { event_type: string }[];
  res.json({ types: [...new Set(rows.map((r) => r.event_type))].sort() });
});
