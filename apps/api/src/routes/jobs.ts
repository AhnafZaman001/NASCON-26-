import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { drainEmails } from "../lib/mailer.ts";

// Called by the database scheduler (pg_cron -> pg_net), never by browsers. Protected by CRON_SECRET.
export const jobs = Router();

jobs.post("/send-emails", async (req, res) => {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const ok = secret.length > 0 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return void res.status(401).json({ error: "Unauthorized." });
  res.json(await drainEmails(50));
});
