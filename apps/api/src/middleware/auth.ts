import type { NextFunction, Request, Response } from "express";
import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabase.ts";

export type AuthedRequest = Request & { user: User };

/** Requires `Authorization: Bearer <supabase access token>` and puts the user on req.user. */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return void res.status(401).json({ error: "missing bearer token" });
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) return void res.status(401).json({ error: "invalid token" });
  (req as AuthedRequest).user = data.user;
  next();
}
