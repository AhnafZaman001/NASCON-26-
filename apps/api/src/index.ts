import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { HttpError } from "./lib/http.ts";
import { auth } from "./routes/auth.ts";
import { me } from "./routes/me.ts";
import { workspace } from "./routes/workspace.ts";
import { members } from "./routes/members.ts";
import { roles } from "./routes/roles.ts";
import { audit } from "./routes/audit.ts";
import { crm } from "./routes/crm.ts";
import { emails } from "./routes/emails.ts";

const app = express();
app.disable("x-powered-by");
app.use(helmet());
// Auth is a Bearer token (no cookies), so cross-site requests can't act as the user (Q3 CSRF).
app.use(cors({ origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",") }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => void res.json({ ok: true }));
app.use("/api/auth", auth);
app.use("/api/me", me);
app.use("/api/workspace", workspace);
app.use("/api/members", members);
app.use("/api/roles", roles);
app.use("/api/audit", audit);
app.use("/api", crm);   // /api/crm, /api/companies, /api/contacts, /api/opportunities, /api/export
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

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`[api] listening on http://localhost:${port}`));
