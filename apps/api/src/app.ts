// The Express app (routes + middleware). index.ts runs it as a long-lived server locally;
// api/index.js (repo root) serves the bundled copy as a Vercel serverless function.
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { HttpError } from "./lib/http.ts";
import { auth } from "./routes/auth.ts";
import { me } from "./routes/me.ts";
import { workspace } from "./routes/workspace.ts";
import { members } from "./routes/members.ts";
import { roles } from "./routes/roles.ts";
import { audit } from "./routes/audit.ts";
import { crm } from "./routes/crm.ts";
import { config } from "./routes/config.ts";
import { leads } from "./routes/leads.ts";
import { messaging } from "./routes/messaging.ts";
import { emails } from "./routes/emails.ts";
import { calendar } from "./routes/calendar.ts";

const app = express();
// behind Vercel / any proxy: real client IPs for rate limiting
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet());
// Auth is a Bearer token (no cookies), so cross-site requests can't act as the user (Q3 CSRF).
app.use(cors({ origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",") }));
app.use(express.json({ limit: "1mb" }));
// Q1/Q3: blunt abuse protection for every route (signup has a stricter limit of its own).
app.use("/api", rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many requests. Slow down and try again in a minute." } }));

app.get("/api/health", (_req, res) => void res.json({ ok: true }));
app.use("/api/auth", auth);
app.use("/api/me", me);
app.use("/api/workspace", workspace);
app.use("/api/members", members);
app.use("/api/roles", roles);
app.use("/api/audit", audit);
app.use("/api", crm);   // /api/crm, /api/companies, /api/contacts, /api/opportunities, /api/export
app.use("/api", config);   // /api/pipelines, /api/stages, /api/fields, /api/lists
app.use("/api", leads);    // /api/leads, /api/public/capture
app.use("/api", messaging); // /api/contacts/:id/messages, /api/messages/:id/retry, /api/webhooks/twilio
app.use("/api", calendar);  // /api/calendar/*, /api/appointments (Google Calendar, M9)
app.use("/api/emails", emails);

app.use((_req, res) => void res.status(404).json({ error: "Not found." }));
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return void res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  if (err?.type === "entity.parse.failed") return void res.status(400).json({ error: "Request body is not valid JSON." });
  console.error("[api]", err);
  res.status(500).json({ error: "Something went wrong on the server. Please try again." });
};
app.use(onError);

export default app;
