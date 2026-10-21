# PROJECT STATUS: single source of truth

> **Rules for every AI agent that works on this repo (read this block first):**
> 1. **Before you build, change or plan anything, read this whole file.** It replaces the problem statement, the
>    requirements list, the hosting and database details and any verbal briefing. You should not need to ask the
>    human for context that is written here. If something is missing, ask once, then write the answer here.
> 2. **When you finish (or stop partway), update this file in the same commit as your code.** Move items between
>    "Built" and "Left", correct anything that is now wrong, and append an entry to the **Update log** (section 10).
>    Keep it factual: what exists, how it works, where it lives, how to verify it, any gotcha.
> 3. Never write secrets here or anywhere in git (passwords, service keys, tokens, tokens in URLs). Only names of variables.
> 4. If this file and the code disagree, the code wins: fix this file.
> 5. Run `git pull --rebase` before editing this file; other agents edit it too. Resolve conflicts by keeping both
>    agents' information.

---

## 1. What we are building

**NASCON X '26: a Unified Business Management Platform** ("Lead Shield"). It was specified for the NASCON 2026 Web
Development Hackathon (7-hour build). One connected web platform where a small service company (5 to 30 employees, for example
a real-estate agency, a solar installer or a clinic's patient-acquisition team) manages customers and a sales pipeline,
**guarantees that every inbound lead is acted on**, talks to customers, collects payments and books appointments
through real external services (sandbox/test mode), with every important action traceable.

**The problem it solves:** leads are answered late or never because assignment is informal, absent or busy staff still
receive leads, nobody is alerted when a lead waits, the CRM is a fixed structure, and conversations, payments and
appointments live in other tools. Success means: every lead has exactly one accountable owner at any moment and
escalates automatically if ignored; each company shapes its own pipeline/fields/rules without developer help; real
messages, payments and calendar events appear on the right customer record and nothing is silently lost when an
external service fails; access depends on role and permission and is enforced on the server; management sees current
performance and the history of every important action.

**Users:** Owner (runs the company, creates the workspace), Admin (configures, cannot modify the Owner), Manager
(a configurable role made of permissions, not a fourth hard-coded level), User (sales/support employee), Customer (external).
Several companies share the platform and **must be completely isolated** (workspaces).

**In scope:** accounts/workspaces/roles/permissions; customizable CRM (contacts, companies, opportunities, custom
fields, pipelines); lead capture, assignment, acknowledgement, escalation, recovery; audit history; operational
dashboard; real integrations for messaging, payments, calendar plus one notification channel.
**Out of scope:** accounting/ledgers, payroll/shifts, ad analytics, report builder/BI, training modules, public marketing
site, billing for the platform itself.

**Judging:** no separate rubric was supplied. The requirement tables below (F, I, Q) and the metric definitions in section 3
are the acceptance criteria. Timers and thresholds must be configurable so behaviour is observable in seconds in a demo.
Data must be real and stored (database), not hard-coded.

---

## 2. Requirements (acceptance criteria, condensed)

### F1. Accounts, roles, permissions
- **F1.1** Sign up / log in / log out, persistent sessions. Signup creates a new workspace; first user is Owner; refresh keeps the session.
- **F1.2** Three base levels Owner/Admin/User. Owner invites users and assigns levels; Admin cannot modify the Owner; User sees only what permissions allow.
- **F1.3** Configurable permissions not tied to role names. Owner can grant/remove at least: view, create, edit, delete, export on CRM records; manage assignment rules; manage integrations; view audit log.
- **F1.4** Field-level protection: opportunity value hidden/masked without the permission, in lists, detail pages and exports.
- **F1.5** Server-side enforcement: a direct API call by an unauthorized user is rejected (hiding a button is not enough).
- **F1.6** Workspace isolation, including against guessed identifiers.

### F2. Customizable CRM
- **F2.1** Contacts, companies, opportunities with relationships (a contact belongs to a company, has many opportunities; the contact page shows all related records).
- **F2.2** Custom fields created from the UI (text, number, date, dropdown, checkbox), appear on forms and detail pages immediately, no code.
- **F2.3** Different fields for different pipelines while sharing contact info.
- **F2.4** Stage-specific required fields: moving into a configured stage is blocked with a clear message until they are filled.
- **F2.5** Customizable pipeline: add, rename, reorder, delete stages; deleting a stage with opportunities is handled safely; move opportunities on a board or list.
- **F2.6** Filtering (3+ criteria: field, tag, stage, owner, date) and saved lists that update automatically.
- **F2.7** Activity history on contacts and opportunities (notes, stage changes, assignments, field edits, messages, payments, appointments; who and when).
- **F2.8** Complete customer view: conversations, opportunities, payments, appointments, assigned employee, activity history on one contact page.

### F3. Lead protection (the central business problem)
- **F3.1** Lead capture from a public web form, an incoming message on the messaging integration, and manual entry, each with a source label.
- **F3.2** Employee availability: Available, Busy, On leave, Offline (self or Admin can set).
- **F3.3** Configurable assignment: at least round-robin among Available employees plus a max open leads per employee; non-Available employees never receive leads.
- **F3.4** Acknowledgement window: assignee is notified and must acknowledge or act within a configurable time; remaining time visible.
- **F3.5** Escalation chain: on expiry go to next eligible employee, then designated backup, then a manager; number of levels and time per level configurable.
- **F3.6** Reassignment on absence: setting On leave/Offline immediately reassigns unacknowledged leads; treatment of already-acknowledged leads is defined and visible.
- **F3.7** Recovery queue page: leads unacknowledged beyond window, escalated more than once, or untouched for a configurable period, with the reason shown.
- **F3.8** No duplicate action: never owned by two people at once; two timers expiring together do not escalate the same lead twice.
- **F3.9** External notification of escalations through the chosen I4 channel.

### F4. Audit history
- **F4.1** Record assignment, acknowledgement, escalation, reassignment, role/permission changes, field/pipeline configuration changes, integration connection changes, deletions: actor (or system), time, target, before/after.
- **F4.2** Only users with the audit permission can open it; filterable by event type, user, date.
- **F4.3** No screen or endpoint can edit or delete history.

### F5. Operational dashboard
- **F5.1** Live overview: new leads today, open pipeline value by stage, average time to first response, recovery-queue items, escalations in last 24h, employee availability, upcoming appointments, payments received this month.
- **F5.2** Every figure follows the definitions in section 3 and matches the underlying records when opened.
- **F5.3** Drill-down: at least three figures open the filtered list of records the user may see.
- **F5.4** Role-aware: User sees personal figures; Owner/Admin see company-wide.
- **F5.5** Basic customization: show/hide figures, remembered.

### I1. Messaging (Twilio WhatsApp Sandbox; Twilio SMS accepted)
- **I1.1** Message from a real phone reaches the platform via the provider webhook and appears in a conversation view.
- **I1.2** Webhooks verified with the provider signature; forged/altered requests rejected and recorded.
- **I1.3** Employee replies from the platform; customer receives it.
- **I1.4** Sent/delivered/failed states from status callbacks stored and shown per message.
- **I1.5** Known number attaches to existing contact; unknown number creates contact and a lead.
- **I1.6** Each conversation shows its assigned employee and is visible only to permitted users.
- **I1.7** Provider rejection/unreachable: message stays visible as failed with reason, employee can retry, nothing silently dropped.
- **I1.8** A webhook delivered twice creates one message and one lead.
- **I1.9** Opted-out contact cannot be messaged; the interface explains why.

### I2. Payments (Stripe test mode)
- **I2.1** From an opportunity, create a payment link/checkout session for an amount and currency; can send it to the customer.
- **I2.2** Completing a test payment updates the opportunity's payment status with no manual action, driven by the webhook.
- **I2.3** Payment webhooks verified with the signature before any record changes.
- **I2.4** Idempotent: same event twice records the payment once.
- **I2.5** Expired, abandoned, failed payments show correct status; a refund made in the provider dashboard is reflected.
- **I2.6** Collected vs expected distinguished; dashboard uses collected revenue only for payments received.
- **I2.7** Traceability: each payment shows opportunity, contact, requesting employee, provider reference.
- **I2.8** Card data never stored or logged; entered only on the provider's hosted page.

### I3. Calendar (Google Calendar, OAuth 2.0)
- **I3.1** Employee connects their own Google account via OAuth consent and can disconnect.
- **I3.2** Tokens refreshed automatically, stored only on the server; revoked/expired connection detected and shown as needing reconnect.
- **I3.3** From an opportunity/contact, book an appointment that appears in the employee's real Google Calendar and on the customer record.
- **I3.4** Booking screen reads busy times and prevents or warns about overlaps.
- **I3.5** Time zones display correctly and are stored unambiguously.
- **I3.6** Reschedule/cancel in the platform updates the Google event and is recorded in activity history.
- **I3.7** Connection status visible to Admins; an employee without a connected calendar cannot be booked and sees why.

### I4. Notifications (team picked one: transactional email via SMTP/nodemailer)
- **I4.1** On escalation the new owner receives a message on the channel within the same minute.
- **I4.2** Alert names the lead, source, reason for escalation and a link that opens the lead.
- **I4.3** Each employee configures their own destination.
- **I4.4** A failed alert is recorded, retried a limited number of times, visible to Admins.

### I5. Shared by every integration
- **I5.1** Central integrations page: status (not connected, connected, error), last worked, recent errors.
- **I5.2** Per-workspace configuration; one workspace's connection never used by another.
- **I5.3** Secrets never sent to the browser, never committed, never shown in full in the UI.
- **I5.4** Synchronization history: every inbound event and outbound call recorded with time, result, reference; reviewable by authorized users.
- **I5.5** Temporary provider errors retried with delay; permanent errors shown with a plain explanation.
- **I5.6** The UI states each integration's limits (for example the WhatsApp sandbox only reaches phones that joined it).
- **I5.7** Only users with the integration permission can connect/change/remove; each change audited.
- **I5.8** If one provider is down the rest of the platform keeps working.

### Quality requirements (apply to everything)
- **Q1** Passwords hashed (recognized algorithm); sessions expire and can be ended; login protected against repeated guessing.
- **Q2** Every endpoint checks workspace and permission server-side; ids in URLs cannot reach other users'/workspaces' data.
- **Q3** Server-side validation of all input; protection against injection, XSS and CSRF; imported/uploaded content never trusted.
- **Q4** Data integrity: deleting/changing a stage, field, user or contact never leaves orphaned or contradictory data; concurrent edits do not silently overwrite each other.
- **Q5** Assignment, escalation and webhook handling correct when events arrive at once or twice, and when the server restarts with timers running.
- **Q6** All data in a real database, survives restart; interface-made configuration stored per workspace.
- **Q7** Responsive on phone, tablet, laptop, no horizontal scrolling or hidden controls.
- **Q8** Accessibility: keyboard use, form labels, colour not the only meaning, readable contrast.
- **Q9** Performance: lists of several hundred records paginate (or equivalent); search/filters do not freeze the UI; slow operations show progress.
- **Q10** Every action shows loading, success and failure; errors say what went wrong and what to do.
- **Q11** New leads, escalations, incoming messages appear without manual refresh.
- **Q12** The same figure shows the same value on every screen (shared records and definitions).
- **Q13** Settings and secrets outside source code; a new person can start the app from written instructions and sample data.
- **Q14** Code separates business rules, data access, integrations, presentation.

---

## 3. Glossary and metric definitions (one meaning everywhere)

| Term | Definition |
|---|---|
| Workspace | One company's isolated environment: users, data, configuration, integrations |
| Lead | A record created by intake (web form, incoming message, manual entry) with a source label |
| Assigned time | The moment the system last assigned the lead to a person |
| Acknowledged | Assignee clicked Acknowledge, or performed a recorded action on the lead (note, message, call log, stage change, appointment) |
| Time to first response | From the lead's first assignment to its first acknowledgement |
| Escalation | An automatic reassignment caused by an expired window; manual reassignments are counted separately |
| Recovery queue item | Unacknowledged beyond its window, OR escalated 2+ times, OR no recorded action for the configured idle period |
| Available employee | Status Available AND open-lead count below the configured limit |
| Open pipeline value | Sum of values of opportunities not in a won/lost stage, grouped by stage; only for users permitted to see values |
| Projected revenue | Value of open opportunities plus payment requests not yet paid |
| Collected revenue | Sum of payments confirmed by the provider webhook, minus confirmed refunds |
| Conversation | All messages with one contact on one channel, linked to the contact, assigned employee and, if applicable, an opportunity |
| Appointment | A calendar event created from the platform and linked to a contact or opportunity |
| Integration event | Any inbound webhook or outbound call to an external provider, recorded in the sync history |

Data model in plain words: a **contact** is the person (permanent; owns conversations, payments, appointments);
a **lead** is one enquiry that must be protected (one accountable owner, ack deadline, escalation count; a returning
customer creates a new lead on the same contact); an **opportunity** is the deal (pipeline, stage, value, payment status).

---

## 4. Links, access and environment (no secrets here)

| Thing | Value |
|---|---|
| GitHub repo | https://github.com/AhnafZaman001/NASCON-26-.git (default branch `main`; several people and agents push directly to `main`) |
| Supabase project ref | `bjbwdtlznujrresmhhyv` |
| Supabase URL | https://bjbwdtlznujrresmhhyv.supabase.co |
| Supabase dashboard | https://supabase.com/dashboard/project/bjbwdtlznujrresmhhyv |
| Supabase publishable key | `sb_publishable_ST_PQ_on6YxsNmjloepezA_IYmAKEZQ` (public by design; safe in browser code) |
| Hosting | Vercel "services" mode (`vercel.json`): `web` (Vite static) + `api` (Express, pre-bundled). Production URL: _not recorded yet; add it here when known_ |

**Secrets the human holds (never in git, never ask the human to paste them in chat):** Supabase DB password and secret
(service-role) key, GitHub token, SMTP password, Twilio auth token, Google OAuth client secret, token-encryption key.
You do not need any of them to read or edit this repo; they only matter for running the app or applying SQL.

**Environment variable names** (copy each `.env.example`, files are gitignored):
- `apps/web/.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- `apps/api/.env`: `PORT`, `CORS_ORIGIN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `REDIS_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` (optional: `GOOGLE_REDIRECT_URI`, `WEB_URL`, `PUBLIC_API_URL`)
- `apps/worker/.env`: `SUPABASE_*`, `REDIS_URL`, `SMTP_*`
- Vercel project: the same API variables must be set there.

**Setup from zero:** `git pull`, `npm install`, create the env files above, apply the database (`supabase link --project-ref bjbwdtlznujrresmhhyv`
then `supabase db push`, or paste `supabase/setup_all.sql` into the Supabase SQL Editor on an EMPTY database; verify the
result with `supabase/checks.sql`; optional demo data in `supabase/demo_seed.sql` after the first signup), then
`npm run dev:api` and `npm run dev` (web on 5173, API on 4000). Full commands and coding rules are in `CLAUDE.md`.

External-service constraints to remember: WhatsApp sandbox only reaches phones that sent the join phrase; Google OAuth
app is in Testing so only listed test users can connect (and refresh tokens are short-lived); Stripe is test mode only;
all webhooks need a public HTTPS address (deployed URL or tunnel).

---

## 5. Architecture and approaches

**Stack:** npm-workspaces monorepo. `apps/web` React 19 + Vite + React Router 7 + Tailwind 4. `apps/api` Express 5 +
TypeScript (zod validation). `apps/worker` BullMQ email consumer (needs Redis). `packages/queue` shared queue contract.
`packages/ui` shared constants incl. permission keys (`perms.ts`). `supabase/` ordered SQL migrations. (The project started
on Next.js and was replaced by Vite + Express; do not bring Next.js back.)

**Key approaches (decisions already made; do not reopen without a reason):**
- **One workspace per user.** `members.user_id` is unique; signup calls the SQL function `bootstrap_workspace` which creates the workspace, default roles (Admin, Manager, Sales), the Owner member, a default pipeline and stages.
- **Tenant isolation in two layers.** Every table has `workspace_id` with RLS so browsers can only READ their own workspace; ALL writes go through the Express API using the service role after a workspace + permission check (`requireMember`, `requirePerm`). Ids from the client are always scoped to the caller's workspace; foreign ids return 404.
- **Permissions are data.** Owner holds everything; everyone else gets exactly what their role's permission list grants (`has_perm()` in SQL, `can()` in the UI, same keys from `packages/ui/src/perms.ts`).
- **Value masking.** Opportunity value is not directly selectable by browsers; reads go through view `opportunities_v` / API DTOs that null the value without `values.view`; CSV export does the same.
- **Postgres owns all lead timing.** Assignment, acknowledgement, escalation and absence handling are SQL functions with row locks (`FOR UPDATE SKIP LOCKED`), run every 10 s by `pg_cron`, plus an API sweep as fallback (migration 0018). No timers in Node or the browser for live mode. This is what makes F3.8/Q5 hold (duplicates, restarts).
- **Escalation semantics.** Chain steps are configurable (default: next eligible employee, backup, manager). Going On leave/Offline reassigns unacknowledged leads immediately (reason `absence`); already-acknowledged leads stay with their owner and are flagged `owner_away` so a manager can reassign. Manual reassignments are recorded with reason `manual`, never counted as escalations.
- **Audit is tamper-proof.** `audit_log` is append-only (triggers block UPDATE/DELETE/TRUNCATE). Triggers log config tables; lead events are logged inside the SQL functions. Writes via the API set the actor with `api_set_actor` first so audit rows name the right person.
- **Integrity in the database.** `opportunity_guard` trigger enforces stage-required fields and stage/pipeline match and bumps `version`; `delete_stage()` forces a destination stage when deals exist; `stage_required_fields` join table (0013).
- **Secrets encrypted at rest.** Integration tokens are AES-GCM encrypted (`TOKEN_ENCRYPTION_KEY`) in `integration_secrets`, which has no browser grants. Only non-secret config is readable by clients.
- **Webhook safety.** Twilio webhooks verify the signature and are idempotent through `integration_events`/`messages.provider_sid` uniqueness. A 5-second poller of Twilio's message log also exists so it works on localhost without a tunnel.
- **Realtime (Q11).** The web store subscribes to Supabase realtime on `leads`, `messages`, `appointments` and re-syncs from the API.
- **Two frontend modes.** `apps/web/src/lib/store.ts` has *live* mode (signed in with Supabase Auth, data from the API) and *demo* mode (sample workspace in localStorage, no account). Demo mode mirrors server rules for show purposes; the real backend is authoritative.
- **Email transport is SMTP via nodemailer** (Gmail app password in the event setup). Credentials only in env.
- **Vercel deployment.** `apps/api` is deployed pre-bundled: after ANY `apps/api` change run `npm run bundle:api` and commit `apps/api/dist/app.cjs`, or production serves stale code.
- **Database change rule.** New numbered file in `supabase/migrations/` (next is `20261018000020_*.sql`), never edit an applied migration, then regenerate `supabase/setup_all.sql`.

Database objects (23 tables, RLS on all): workspaces, roles, members, companies, contacts, pipelines, stages,
stage_required_fields, field_definitions, opportunities, saved_lists, leads, lead_assignments, activities, messages,
payments, appointments, integrations, integration_secrets, integration_events, notification_outbox, emails, audit_log.
Views: opportunities_v, recovery_queue_v, leads_v. Key functions: has_perm, current_member_id, current_workspace_id,
pick_assignee, assign_lead, acknowledge_lead, escalate_expired_leads, set_member_status, reassign_lead, delete_stage,
dashboard_metrics (written, not yet used by the app), bootstrap_workspace, `api_*` write functions (0014 to 0017),
claim_user_emails. Migrations 0001 to 0019 are in `supabase/migrations/`.

---

## 6. Built so far (what exists and how)

Baseline: commit `ad7539a`. Frontend pages: login, signup, dashboard, leads, contacts, pipeline, inbox, payments,
calendar, integrations, audit, settings, public lead capture.

- **Accounts, roles, permissions (F1, Q1, Q2): live.** Supabase Auth in the web app; `POST /api/auth/signup`, `GET /api/me`, `/api/workspace`, `/api/members`, `/api/roles`. Workspace payload from `/api/me` feeds the store. Permission editor and invites in Settings.
- **CRM records (F2.1, F2.7, F2.8): live.** `/api/crm` snapshot, `/api/companies`, `/api/contacts` (+ `/notes`, `/timeline`), `/api/opportunities`, CSV export under `/api/export/*.csv`. Value masking applied.
- **CRM customization (F2.2 to F2.6): live.** `/api/pipelines`, `/api/stages`, `/api/fields`, `/api/lists`. Custom fields per pipeline, stage-required fields enforced in the DB, safe stage deletion, saved lists.
- **Lead engine (F3, Q5): live.** `/api/leads`, `POST /api/public/capture/:workspaceId` (public web form), acknowledge, reassign, availability, recovery queue. Timing is in Postgres (pg_cron + 0018 API fallback). Verified on a local Postgres by the SQL author: round-robin, full escalation chain with no double escalation, absence reassignment, value masking, workspace isolation, audit immutability.
- **Audit (F4): live.** `/api/audit` with filters; append-only in the database.
- **Messaging, Twilio WhatsApp (I1): live.** Inbound webhook with signature validation and a 5 s poller, send, retry of failed messages, delivery status, contact matching, conversation view in Inbox. (Per-workspace credentials are NOT done: Twilio credentials are currently one set of server env variables.)
- **Calendar, Google (I3): live.** `/api/calendar/{status,connect,callback,disconnect,busy}`, `/api/appointments` (+ PATCH and `/:id/cancel`). OAuth tokens AES-GCM encrypted in `integration_secrets`; free/busy conflict check; book, move, cancel on the real Google Calendar. Migration 0019.
- **Realtime (Q11):** Supabase realtime subscriptions on leads, messages, appointments.
- **Email groundwork (I4):** `emails` table (0011), `claim_user_emails`, BullMQ worker with nodemailer, `POST /api/emails/send`. Per-user destination exists in settings. NOT yet wired to escalation (see Left).
- **Deployment config:** `vercel.json` services mode; API pre-bundled.
- **Demo mode** in the frontend (localStorage sample workspace) including a simulated Payments page.
- **Checks that passed at baseline:** `npm run build` (web), `npm run typecheck` (api + worker), engine test `npm run test:engine -w @nascon/web`. `npm run lint` FAILS (config issue, see Left).

---

## 7. Left to build (ordered by impact; also read "Known gaps")

1. **Stripe payments (I2.1 to I2.8): not started on the server.** The Payments page is simulated. Needs: checkout session/link creation per opportunity, webhook with signature check and idempotency via `integration_events`, statuses paid/failed/expired/refunded (partial refunds), collected vs projected revenue, `opportunities.payment_status` updates, payment rows with provider reference and requesting employee, no card data stored. The `payments` table exists (0004).
2. **Email alerts on assignment/escalation (I4.1 to I4.4, F3.9): not wired.** Nothing inserts into `emails` when a lead is assigned or escalated, and the worker runs only when triggered by hand and needs Redis, which the Vercel setup does not provide. Open decision: drop Redis/BullMQ and send from the API (recommended), with alert content (lead, source, reason, link), limited retries, and failures visible to Admins.
3. **Public deployment and webhook URLs:** confirm the Vercel project is live, set API env vars there, register the Twilio and Stripe webhook URLs and add the production Google OAuth redirect URI (`<domain>/api/calendar/callback`). Record the production URL in section 4.
4. **Dashboard from the database (F5, Q12):** no dashboard API; figures are computed in the browser from synced state. `dashboard_metrics()` (SQL) exists but is unused. Needs one server-side definition for every figure, drill-down links, role-aware scope, show/hide remembered.
5. **Integrations hub (I5):** page exists but there is no status API. Needs per-workspace credentials for Twilio (and Stripe) encrypted in `integration_secrets`, success AND failure logging in `integration_events` for every provider, visible recent errors, stated limits, audit of connection changes.
6. **Lint:** `npm run lint` fails because the ESLint config references a rule whose plugin is not installed.
7. **Docs and setup (Q13):** README is short; add setup for Supabase, Twilio sandbox, Stripe, Google, SMTP. Verify `supabase/setup_all.sql` includes migrations 0014 to 0019 and regenerate if not.
8. **Tests:** only a browser-side engine test exists. Add SQL concurrency/escalation tests and API permission/isolation tests to the repo.
9. **Quality pass (Q3, Q7 to Q10):** pagination on long lists, keyboard/screen-reader basics, validation and XSS review, loading/error states everywhere.

**Known gaps and unverified items:** Twilio credentials are env-wide, not per-workspace (I5.2); opt-out handling (I1.9), message retry limits, pagination (Q9), accessibility (Q8) and optimistic-lock use in the API (Q4; the `version` column and trigger exist) have not been verified; web bundle is over 500 kB (code-splitting not done).

---

## 8. Conventions (details in `CLAUDE.md`)

- `git pull --rebase` before starting and before every commit; small commits; never force-push.
- Before pushing: `npm run build && npm run lint && npm run typecheck`.
- API rules: scope every query by `ctx.member.workspaceId`, zod-validate every body, throw `HttpError`, guard routes per route not with `router.use`, ES imports use the `.ts` extension.
- Frontend rules: import alias `@/`, `useApp()` gives `{ s, me, can, isAdmin, companyWide }`, API calls through `api()` in `src/lib/api.ts`, theme tokens in `src/index.css`, no secrets in `apps/web`.

## 9. How to record your work here

Edit sections 4, 5, 6, 7 so they stay true, then append to the log below. One entry per task. Include the commit hash
(`git rev-parse --short HEAD`) and today's date (`date -u +%F`).

## 10. Update log (append only, newest at the bottom)

- **Baseline (commit `ad7539a`):** file created from an audit of the repo. Records everything built through Google Calendar
  (`97dffe8`), the agent-context files (`AGENTS.md`, `GEMINI.md`; decisions now live in section 5) and the remaining work in section 7.
  Verify: `npm run build`, `npm run typecheck`, `npm run test:engine -w @nascon/web`; `supabase/checks.sql` on the database.
