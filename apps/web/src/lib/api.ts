import { supabase } from "./supabase";
import type { Member, Role, Settings } from "./types";

/** What GET /api/me (and every team/settings mutation) returns. */
export type ServerWorkspace = {
  workspace: { id: string; name: string };
  meId: string;
  settings: Settings;
  roles: Role[];
  members: (Member & { hiddenTiles: string[] })[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

/** Calls apps/api with the current Supabase access token. Vite proxies /api to localhost:4000 in dev. */
export async function api<T = ServerWorkspace>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (${res.status}).`, json.details?.fields);
  return json as T;
}

/** Download a file from the API (e.g. a CSV export) with the user's token. */
export async function download(path: string, filename: string) {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`/api${path}`, { headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {} });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j.error ?? `Download failed (${res.status}).`);
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob()); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
