import { supabaseAdmin } from "./supabase.ts";
import { must } from "./http.ts";
import { memberDto, roleDto, settingsToUi, type MemberRow, type RoleRow } from "./dto.ts";

const MEMBER_COLS = "id, email, full_name, level, role_id, status, notify_destination, calendar_status, dashboard_prefs";

/** Everything the web app needs to boot a signed-in session (GET /api/me). */
export async function loadWorkspace(workspaceId: string, meId: string) {
  const db = supabaseAdmin();
  const [ws, roles, members] = await Promise.all([
    db.from("workspaces").select("id, name, settings").eq("id", workspaceId).single(),
    db.from("roles").select("id, name, permissions").eq("workspace_id", workspaceId).order("name"),
    db.from("members").select(MEMBER_COLS).eq("workspace_id", workspaceId).order("created_at"),
  ]);
  const w = must(ws);
  const r = must(roles) as RoleRow[];
  const m = must(members) as MemberRow[];
  return {
    workspace: { id: w.id, name: w.name },
    meId,
    settings: settingsToUi(w.settings ?? {}),
    roles: r.map(roleDto),
    members: m.map((x) => memberDto(x, r)),
  };
}
