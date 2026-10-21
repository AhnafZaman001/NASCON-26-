# Decisions already made (do not reopen without a reason)

- **One workspace per user.** `members.user_id` is unique. Signup calls `bootstrap_workspace`.
- **Postgres owns all timers.** Assignment, acknowledgement and escalation are SQL functions with row locks
  (`FOR UPDATE SKIP LOCKED`), run by `pg_cron` every 10 s, with an API sweep as fallback. No timers in Node or the browser.
- **Permissions are data.** Owner has all; everyone else gets what their role lists. Keys are in `packages/ui/src/perms.ts`.
- **Opportunity value masking.** Hidden for users without `values.view` (view `opportunities_v` and API responses).
- **All writes go through the API (service role)** after a permission and workspace check; browsers only read via RLS.
- **Audit log is append-only** (triggers block update/delete/truncate). Set `app.actor` before service-role writes.
- **Secrets are encrypted** (AES-GCM, `TOKEN_ENCRYPTION_KEY`) in `integration_secrets`; no grants to browsers.
- **Email transport is SMTP via nodemailer** (Gmail app password for the event). Credentials only in env.
- **Acknowledged leads stay with their owner when that person goes away**; unacknowledged ones are reassigned (reason `absence`).
  Away owners are flagged `owner_away` so a manager can reassign.
- **Contact vs lead vs opportunity:** a contact is the person, a lead is one enquiry that must be protected, an opportunity is the deal.

## Open decisions
- Remove Redis/BullMQ and send email from the API? (recommended; see T2)
