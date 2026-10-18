import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase.ts";
import { HttpError, dbError, parse } from "../lib/http.ts";

export const auth = Router();

// Q1: slow down repeated attempts. Password login itself goes to Supabase Auth, which has its own limits.
const limiter = rateLimit({
  windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

const Signup = z.object({
  company: z.string().trim().min(1, "Enter your company name.").max(120),
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters.").max(128),
});

// F1.1: sign up creates the auth user, a new workspace and makes them its Owner.
// The client then signs in with the same email/password to get a session.
auth.post("/signup", limiter, async (req, res) => {
  const b = parse(Signup, req.body);
  const db = supabaseAdmin();
  const { data, error } = await db.auth.admin.createUser({
    email: b.email, password: b.password, email_confirm: true, user_metadata: { full_name: b.name },
  });
  if (error || !data.user) {
    if (/already|exists|registered/i.test(error?.message ?? "")) throw new HttpError(409, "An account with this email already exists. Log in instead.");
    throw new HttpError(400, error?.message ?? "Could not create the account.");
  }
  const ws = await db.rpc("bootstrap_workspace", { p_user: data.user.id, p_name: b.company, p_email: b.email, p_full_name: b.name });
  if (ws.error) {
    await db.auth.admin.deleteUser(data.user.id);   // don't leave a login without a workspace
    throw dbError(ws.error)!;
  }
  res.status(201).json({ workspaceId: ws.data });
});
