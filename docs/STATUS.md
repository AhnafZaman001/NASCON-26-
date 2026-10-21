# Status board (live)

Edit this file to claim and finish tasks; pull before editing, push right after. Baseline: commit `97dffe8`.
Owner = agent/person name. Status = `todo` | `in progress` | `blocked` | `done`.

## Already live on the real backend (do not rebuild)
Auth + signup, team/roles/permissions, CRM records, pipelines/stages/fields/lists/export, lead capture + assign + acknowledge +
reassign + availability, escalation (Postgres `pg_cron` + API sweep fallback), audit log, Twilio WhatsApp, Google Calendar.

## Open tasks (highest priority first)

| ID | Task | Requirements | Owner | Status | Files / notes |
|---|---|---|---|---|---|
| T1 | **Stripe payments.** Checkout link per opportunity, webhook with signature check + idempotency (`integration_events`), states paid/failed/expired/refunded (partial too), collected vs projected revenue, set `opportunities.payment_status`. Replace the simulated Payments page. | I2.1-I2.8 | unclaimed | todo | new `apps/api/src/routes/payments.ts`, `lib/stripe.ts`; tables `payments` already exist (0004); UI `pages/Payments.tsx`, `lib/store.ts` |
| T2 | **Email alerts on assign/escalate.** Nothing creates `emails` rows today. Create a row when a lead is assigned/escalated (lead, source, reason, link), send via nodemailer with limited retries, show failures. Preferred: no Redis (Vercel cannot run the worker) - send from the API. | I4.1-I4.4, F3.9 | unclaimed | todo | new migration (hook `assign_lead`), `routes/emails.ts`, `apps/worker`, `packages/queue` |
| T3 | **Deploy + public URLs.** Confirm Vercel project is live; set env vars; register webhook URLs (Twilio, Stripe) and Google redirect URI for the production domain. | Q6, I1, I2, I3 | unclaimed | todo | `vercel.json`, Vercel dashboard |
| T4 | **Dashboard from the database.** Serve figures from SQL (`dashboard_metrics()` exists, unused) via `/api/dashboard`; drill-down links; same numbers on every screen. | F5.1-F5.5, Q12 | unclaimed | todo | new `routes/dashboard.ts`, `pages/Dashboard.tsx` |
| T5 | **Integrations hub.** Status API for every provider; per-workspace credentials encrypted in `integration_secrets` (Twilio today is env-wide); log successes AND failures in `integration_events`; show recent failures. | I5.1-I5.8 | unclaimed | todo | `routes/` new `integrations.ts`, `lib/twilio.ts`, `pages/Integrations.tsx` |
| T6 | Fix ESLint config (rule `@typescript-eslint/no-unused-vars` referenced without the plugin installed; `npm run lint` fails). | Q13 | unclaimed | todo | `apps/web/eslint.config.*` |
| T7 | README: full setup (Supabase, Twilio sandbox, Stripe, Google, SMTP), seed steps. Regenerate `supabase/setup_all.sql` so it includes migrations 0014-0019. | Q13 | unclaimed | todo | `README.md`, `supabase/setup_all.sql` |
| T8 | Tests: SQL concurrency/escalation tests and API permission/isolation tests into the repo. | Q5, Q2 | unclaimed | todo | new `supabase/tests/`, `apps/api/tests/` |
| T9 | QA pass: pagination on long lists, keyboard + screen-reader basics, input validation, XSS, loading/error states. | Q3, Q7-Q10 | unclaimed | todo | `apps/web`, `apps/api` |

## Known risks
- Vercel runs the API as a pre-bundled file: forgetting `npm run bundle:api` ships stale code.
- Demo mode (localStorage) mirrors server rules in `lib/store.ts`; keep the real backend authoritative.
- Google OAuth app is in Testing: every demo Gmail must be on the test-user list. Twilio sandbox: every demo phone must join.
