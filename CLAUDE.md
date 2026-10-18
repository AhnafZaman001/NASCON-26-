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
```
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
- App state currently lives in a client store (`src/lib/store.ts`, persisted to localStorage, demo seed in `src/lib/seed.ts`). `useApp()` in `src/lib/app.ts` gives `{ s, me, can, isAdmin, companyWide }`; gate UI with `can("perm.name")`.
- UI primitives: `src/components/ui.tsx` (Button, Card, Stat, Empty, Avatar...). Icons: `lucide-react`.
- Styling: Tailwind 4 with theme tokens in `src/index.css` (`bg-surface`, `text-muted`, `border-line`, `text-brand`, `text-ok/warn/bad`). Light and dark both supported via CSS vars; don't hardcode colors.
- Env: only `VITE_*` vars reach the browser (`import.meta.env`). Never put secrets in `apps/web`.

## Backend (apps/api)
- Entry `src/index.ts`; routers in `src/routes/`, mounted under `/api/...`.
- `supabaseAdmin()` (`src/lib/supabase.ts`) is the service-role client and bypasses RLS: always check the caller's workspace and permission before using it.
- `requireUser` middleware verifies `Authorization: Bearer <supabase access token>` and sets `req.user`.
- Local ES imports use the `.ts` extension (`./routes/emails.ts`), run by tsx.

## Database (Supabase, project ref `bjbwdtlznujrresmhhyv`)
- Add schema changes as a new numbered file in `supabase/migrations/` (next: `20261018000014_*.sql`; then regenerate `supabase/setup_all.sql`). Never edit an applied migration.
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
