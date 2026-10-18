# CLAUDE.md

NASCON '26 hackathon project ("Lead Shield"): a CRM with guaranteed lead ownership, escalation, payments, calendar and integrations. Several people (and AI tools) push to `main` directly. **Always `git pull` before you start and before you commit.**

## Layout (npm workspaces monorepo)
```
apps/web        React 19 + Vite + React Router 7 + Tailwind 4 (frontend, port 5173)
apps/api        Express 5 + TypeScript via tsx (backend, port 4000)
apps/worker     BullMQ consumer: sends rows from public.emails with nodemailer
packages/queue  Shared BullMQ contract (EMAIL_QUEUE, EmailJob, enqueueUserEmails)
packages/ui     Shared constants
supabase/       Ordered SQL migrations + checks.sql + demo_seed.sql
docs/modules.md Problem statement split into modules M0-M12 with requirement IDs and status
```
When picking up work, find its module in `docs/modules.md` and check the requirement IDs (F/I/Q) it must satisfy.
There is no Next.js anymore. Do not add it back or use `next/*` imports.

## Commands (run from repo root)
```
npm install
npm run dev            # web (Vite proxies /api -> localhost:4000)
npm run dev:api        # Express API
npm run dev:worker     # email worker (needs Redis)
npm run build          # tsc + vite build for web
npm run lint           # eslint for web
npm run typecheck      # api + worker
npm run test:engine -w @nascon/web   # lead engine checks
```
Before pushing: `npm run build && npm run lint && npm run typecheck` must pass.

## Frontend (apps/web)
- Routes live in `src/App.tsx`; pages in `src/pages/*.tsx`. Signed-in pages render inside `Shell` via the `AppLayout` route (it redirects to `/login` when logged out).
- Navigation: `Link to=` / `useNavigate()` / `useSearchParams()` from `react-router-dom`.
- Import alias `@/` = `apps/web/src`.
- State: `src/lib/store.ts` has two modes. **live** = signed in with Supabase Auth; workspace, members, roles and settings come from `GET /api/me` and every change to them goes through the API. **demo** = sample workspace in localStorage (no account). Modules not yet migrated (CRM, leads, messages...) still keep their data in localStorage per workspace; moving each onto the API is the remaining work (see docs/modules.md). `useApp()` in `src/lib/app.ts` gives `{ s, me, can, isAdmin, companyWide }`; gate UI with `can("perm.name")`.
- Server calls: `api(path, { method, body })` from `src/lib/api.ts` (adds the Supabase Bearer token). In the store, live actions use `remote()`, which applies the returned workspace payload and toasts errors.
- Permission keys live in `packages/ui/src/perms.ts` (shared with the API). Do not invent new strings elsewhere.
- UI primitives: `src/components/ui.tsx` (Button, Card, Stat, Empty, Avatar...). Icons: `lucide-react`.
- Styling: Tailwind 4 with theme tokens in `src/index.css` (`bg-surface`, `text-muted`, `border-line`, `text-brand`, `text-ok/warn/bad`). Light and dark both supported via CSS vars; don't hardcode colors.
- Env: only `VITE_*` vars reach the browser (`import.meta.env`). Never put secrets in `apps/web`.

## Backend (apps/api)
- Entry `src/index.ts`; routers in `src/routes/`, mounted under `/api/...`.
- `supabaseAdmin()` (`src/lib/supabase.ts`) is the service-role client and bypasses RLS: always check the caller's workspace and permission before using it.
- Auth middleware (`src/middleware/auth.ts`): `requireMember` verifies the Bearer token and loads `req.ctx = { user, member: { id, workspaceId, level, roleId }, perms }` (read it with `ctxOf(req)`); then `requirePerm("crm.edit")` or `requireTeamManager`. Always scope queries with `ctx.member.workspaceId`, never a workspace id from the client. Return 404 for ids outside the workspace.
- Validate every body/param with zod via `parse(Schema, req.body)` (400 with per-field messages). Throw `HttpError(status, message)`; Express 5 forwards async errors to the handler in `src/index.ts`. Unwrap supabase results with `must()`.
- Writes that should be audited go through SQL functions that call `api_set_actor(actor)` first (see migration 0014, `api_*` functions), because plain PostgREST writes cannot set `app.actor`.
- Routes so far: `/api/auth/signup`, `/api/me`, `/api/workspace`, `/api/members`, `/api/roles`, `/api/audit`, CRM (`/api/crm` snapshot, `/api/companies`, `/api/contacts` + `/notes` + `/timeline`, `/api/opportunities`, `/api/export/*.csv`), config (`/api/pipelines`, `/api/stages`, `/api/fields`, `/api/lists`), leads (`/api/leads`, `/api/public/capture/:workspaceId`), messaging (`/api/contacts/:id/messages`, `/api/messages/:id/retry`, `/api/webhooks/twilio/*`; Twilio is polled every 5 s so it works on localhost), `/api/emails`. Lead timing lives in Postgres (pg_cron + `escalate_expired_leads`); never add timers in Node or the browser. Routers mounted at `/api` must guard per route (see `allow()` in `routes/crm.ts`), never `router.use`.
- Local ES imports use the `.ts` extension (`./routes/emails.ts`), run by tsx.

## Database (Supabase, project ref `bjbwdtlznujrresmhhyv`)
- Add schema changes as a new numbered file in `supabase/migrations/` (next: `20261018000019_*.sql`; then regenerate `supabase/setup_all.sql`). Never edit an applied migration.
- Every table has `workspace_id`. Browsers can only READ their own workspace through RLS. All writes go through the API with the service role.
- New tables need: `enable row level security`, a select policy using `current_workspace_id()` / `has_perm()`, and `grant ... to service_role`.
- `audit_log` is append-only. Set `select set_config('app.actor', '<member uuid>', true)` before service-role writes so audit rows name the right person.

## Email pipeline
1. Insert rows into `public.emails` (status `pending`).
2. `POST /api/emails/send` (or `npm run enqueue -w @nascon/worker -- <user-uuid>`) queues `{ userId }` on BullMQ.
3. `apps/worker` calls `claim_user_emails(user_id)`, sends via nodemailer, marks `sent` / retry / `failed`.

## Env files (all gitignored, copy from `.env.example`)
- `apps/web/.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- `apps/api/.env`: `PORT`, `CORS_ORIGIN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `REDIS_URL`
- `apps/worker/.env`: `SUPABASE_*`, `REDIS_URL`, `SMTP_*`

Never commit secrets, tokens or `.env` files.
