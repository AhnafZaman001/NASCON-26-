// Shapes sent to apps/web. Keeps DB naming (snake_case, on_leave, ...) out of the UI.
import { ALL_PERM_KEYS, isPerm, type Perm } from "@nascon/ui";

export type Availability = "available" | "busy" | "leave" | "offline";
const toUiStatus = (s: string): Availability => (s === "on_leave" ? "leave" : (s as Availability));
export const toDbStatus = (s: Availability) => (s === "leave" ? "on_leave" : s);

export type RoleRow = { id: string; name: string; permissions: string[] };
export type MemberRow = {
  id: string; email: string; full_name: string; level: "owner" | "admin" | "user"; role_id: string | null;
  status: string; notify_destination: string | null; calendar_status: string; dashboard_prefs: Record<string, unknown>;
};

export const roleDto = (r: RoleRow) => ({ id: r.id, name: r.name, perms: r.permissions.filter(isPerm) as Perm[] });

export function memberDto(m: MemberRow, roles: RoleRow[]) {
  const role = roles.find((r) => r.id === m.role_id) ?? null;
  return {
    id: m.id,
    name: m.full_name || m.email,
    email: m.email,
    level: m.level,
    roleId: m.role_id,
    roleName: m.level === "owner" ? "Owner" : role?.name ?? "No role",
    perms: m.level === "owner" ? ALL_PERM_KEYS : ((role?.permissions ?? []).filter(isPerm) as Perm[]),
    status: toUiStatus(m.status),
    notifyDest: m.notify_destination ?? m.email,
    calendar: m.calendar_status === "connected" ? "connected" : m.calendar_status === "needs_reconnect" ? "needs_reconnect" : "none",
    hiddenTiles: Array.isArray(m.dashboard_prefs?.hidden) ? (m.dashboard_prefs.hidden as string[]) : [],
  };
}

/* ---- workspace.settings (DB jsonb, read by the SQL lead engine) <-> UI settings ---- */
type Step = "next" | "backup" | "manager";
export type UiSettings = {
  maxOpenLeads: number; idleSeconds: number; backupId: string | null; managerId: string | null;
  ackedOnAbsence: "keep" | "reassign"; levels: { target: "assignee" | Step; seconds: number }[];
};
type DbSettings = {
  ack_window_seconds?: number; max_open_leads?: number; idle_seconds?: number;
  escalation_chain?: { step: Step; window_seconds: number }[];
  backup_member_id?: string | null; manager_member_id?: string | null; acked_on_absence?: "keep" | "reassign";
};

export function settingsToUi(s: DbSettings): UiSettings {
  return {
    maxOpenLeads: s.max_open_leads ?? 10,
    idleSeconds: s.idle_seconds ?? 86400,
    backupId: s.backup_member_id ?? null,
    managerId: s.manager_member_id ?? null,
    ackedOnAbsence: s.acked_on_absence ?? "keep",
    levels: [
      { target: "assignee", seconds: s.ack_window_seconds ?? 300 },
      ...(s.escalation_chain ?? []).map((c) => ({ target: c.step, seconds: c.window_seconds })),
    ],
  };
}

export function settingsToDb(u: Partial<UiSettings>): DbSettings {
  const d: DbSettings = {};
  if (u.maxOpenLeads !== undefined) d.max_open_leads = u.maxOpenLeads;
  if (u.idleSeconds !== undefined) d.idle_seconds = u.idleSeconds;
  if (u.backupId !== undefined) d.backup_member_id = u.backupId;
  if (u.managerId !== undefined) d.manager_member_id = u.managerId;
  if (u.ackedOnAbsence !== undefined) d.acked_on_absence = u.ackedOnAbsence;
  if (u.levels) {
    const [first, ...rest] = u.levels;
    if (first) d.ack_window_seconds = first.seconds;
    d.escalation_chain = rest.map((l) => ({ step: (l.target === "assignee" ? "next" : l.target) as Step, window_seconds: l.seconds }));
  }
  return d;
}
