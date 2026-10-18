import type { NextFunction, Request, Response } from "express";
import type { User } from "@supabase/supabase-js";
import { ALL_PERM_KEYS, type Perm } from "@nascon/ui";
import { supabaseAdmin } from "../lib/supabase.ts";
import { HttpError } from "../lib/http.ts";

export type Level = "owner" | "admin" | "user";
export type MemberCtx = { id: string; workspaceId: string; level: Level; roleId: string | null };
export type Ctx = { user: User; member: MemberCtx; perms: Set<Perm> };

export type AuthedRequest = Request & { user: User };
export type CtxRequest = Request & { user: User; ctx: Ctx };

export const ctxOf = (req: Request) => (req as CtxRequest).ctx;

/** Requires `Authorization: Bearer <supabase access token>` and puts the user on req.user. */
export async function requireUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "You are not signed in.");
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your session has expired. Please sign in again.");
  (req as AuthedRequest).user = data.user;
  next();
}

/**
 * requireUser + loads the caller's membership and effective permissions.
 * Every workspace-scoped route uses req.ctx.member.workspaceId, never a workspace id from the client (F1.6, Q2).
 */
export async function requireMember(req: Request, res: Response, next: NextFunction) {
  await requireUser(req, res, () => {});
  const user = (req as AuthedRequest).user;
  const { data: m } = await supabaseAdmin()
    .from("members")
    .select("id, workspace_id, level, role_id, roles(permissions)")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!m) throw new HttpError(403, "Your account is not part of a workspace.");
  const rolePerms = ((m.roles as unknown as { permissions: string[] } | null)?.permissions ?? []) as Perm[];
  const perms = new Set<Perm>(m.level === "owner" ? ALL_PERM_KEYS : rolePerms);
  (req as CtxRequest).ctx = {
    user,
    member: { id: m.id, workspaceId: m.workspace_id, level: m.level, roleId: m.role_id },
    perms,
  };
  next();
}

export const can = (ctx: Ctx, p: Perm) => ctx.member.level === "owner" || ctx.perms.has(p);

/** Route guard: caller needs at least one of the given permissions (Owner always passes). */
export const requirePerm = (...need: Perm[]) => (req: Request, _res: Response, next: NextFunction) => {
  const ctx = ctxOf(req);
  if (!need.some((p) => can(ctx, p))) throw new HttpError(403, "You don't have permission to do that.");
  next();
};

/** Owner and Admins manage the team; a role with users.manage also qualifies. */
export const canManageTeam = (ctx: Ctx) => ctx.member.level !== "user" || ctx.perms.has("users.manage");
export const requireTeamManager = (req: Request, _res: Response, next: NextFunction) => {
  if (!canManageTeam(ctxOf(req))) throw new HttpError(403, "Only the Owner and Admins can manage the team.");
  next();
};
