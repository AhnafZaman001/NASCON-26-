import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { emails } from "./routes/emails.ts";

const app = express();
app.use(cors({ origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",") }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => void res.json({ ok: true }));
app.use("/api/emails", emails);

app.use((_req, res) => void res.status(404).json({ error: "not found" }));
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("[api]", err);
  res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
};
app.use(onError);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`[api] listening on http://localhost:${port}`));
