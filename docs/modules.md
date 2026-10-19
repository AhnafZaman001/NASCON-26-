# Modules

The problem statement ("Unified Business Management Platform") split into buildable modules.
Requirement IDs (F, I, Q) refer to the problem statement. Status reflects `main` on 2026-10-18.

**Status key:** DB = schema exists in `supabase/migrations` · UI = screen exists (local demo store, not yet on real data) · API = Express route in `apps/api` · — = not started

## Overview

| # | Module | Requirements | DB | UI | API | Depends on |
|---|--------|--------------|----|----|-----|------------|
| M0 | Platform foundation | Q6, Q11, Q13, Q14 | ✅ | ✅ | ✅ auth, me, validation, errors | — |
| M1 | Accounts, roles & permissions | F1.1–F1.6, Q1, Q2 | ✅ 0001, 0008, 0010, 0014 | ✅ live | ✅ | M0 |
| M2 | CRM core records | F2.1, F2.7, F2.8 | ✅ 0002, 0004, 0015 | ✅ live | ✅ | M1 |
| M3 | CRM customization | F2.2–F2.6 | ✅ 0002, 0013, 0016 | ✅ live | ✅ | M2 |
| M4 | Lead engine | F3.1–F3.9, Q5 | ✅ 0003, 0009, 0017 | ✅ live | ✅ | M1, M2 |
| M5 | Audit history | F4.1–F4.3 | ✅ 0006 | ✅ live | ✅ | M1 |
| M6 | Operational dashboard | F5.1–F5.5, Section 7, Q12 | ✅ 0007 | ✅ | — | M2, M4, M8, M9 |
| M7 | Messaging: Twilio WhatsApp | I1.1–I1.9 | ✅ 0004, 0005 | ✅ live | ✅ | M2, M4, M11 |
| M8 | Payments: Stripe | I2.1–I2.8 | ✅ 0004, 0005 | ✅ (simulated) | — | M2, M11 |
| M9 | Calendar: Google OAuth | I3.1–I3.7 | ✅ 0004, 0005, 0019 | ✅ live (demo mode keeps the simulation) | ✅ `routes/calendar.ts` | M1, M2, M11 |
| M10 | Notifications: email | I4.1–I4.4 | ✅ 0005, 0011 | partial | partial (worker) | M4, M11 |
| M11 | Integrations hub (shared) | I5.1–I5.8 | ✅ 0005 | ✅ | — | M1, M5 |
| M12 | Quality & UX (cross-cutting) | Q3, Q4, Q7–Q10 | — | partial | — | all |

**Biggest gap:** every screen still reads `apps/web/src/lib/store.ts` (localStorage). The judges check "real stored data" (F intro, Q6), so moving each module onto Supabase + `apps/api` is the main work left.

---

## M0 · Platform foundation
Shared plumbing everyone else builds on.
- Supabase Auth in the web app (`supabase.auth`), access token sent as `Authorization: Bearer` to `apps/api`
- `apps/api` structure: routers per module, `requireUser` + permission middleware, input validation (zod), error format
- Data access layer in the web app replacing `store.ts` (fetch from API / read via RLS)
- Realtime subscriptions for leads, messages, activities (Q11; publication set up in 0009)
- Deploy: web (Vercel/Netlify), API + worker (Railway/Render), Redis (Upstash), public HTTPS for webhooks
- README setup steps + sample data (Q13)

## M1 · Accounts, roles & permissions
- F1.1 Sign up creates workspace + Owner (`bootstrap_workspace()` in 0010), login/logout, session survives refresh
- F1.2 Owner / Admin / User levels; Owner invites users; Admin cannot modify Owner
- F1.3 Permission editor: `crm.view/create/edit/delete/export`, `assignment.manage`, `integrations.manage`, `audit.view`, `values.view` …
- F1.4 Opportunity value masked without `values.view` (lists, detail, exports) via `opportunities_v`
- F1.5 / Q2 Every API route checks workspace + permission server-side
- F1.6 Workspace isolation (RLS + server checks; guessed IDs return 404)
- Q1 Hashed passwords (Supabase Auth), session expiry, login rate limiting

## M2 · CRM core records
- F2.1 Companies → contacts → opportunities with relationships
- F2.7 Activity timeline per contact/opportunity: notes, stage changes, assignments, field edits, messages, payments, appointments (who + when)
- F2.8 Contact page: conversations, opportunities, payments, appointments, assigned employee, history
- Q4 Optimistic locking on opportunities (`version` column), safe deletes

## M3 · CRM customization
- F2.2 Custom fields from UI (text, number, date, dropdown, checkbox) → `field_definitions`
- F2.3 Different field sets per pipeline (`field_definitions.pipeline_id`)
- F2.4 Stage-specific required fields → `stage_required_fields` (0013), enforced by `opportunity_guard`
- F2.5 Pipeline editor: add / rename / reorder / delete stages (`delete_stage()` handles non-empty stages); board drag-and-drop
- F2.6 Filters with 3+ criteria, saved lists that update live (`saved_lists.filters`)

## M4 · Lead engine (core business problem)
- F3.1 Capture from public web form (`/capture`), incoming WhatsApp (M7), manual entry — each with source label
- F3.2 Employee status: Available / Busy / On leave / Offline
- F3.3 Round-robin among Available employees + max open leads per employee (`pick_assignee`, `assign_lead`)
- F3.4 Acknowledge window with visible countdown
- F3.5 Escalation chain: next → backup → manager, configurable levels and times (`escalate_expired_leads`, pg_cron every 10s)
- F3.6 Going On leave / Offline reassigns unacknowledged leads (`set_member_status`)
- F3.7 Recovery queue with reasons (`recovery_queue_v`)
- F3.8 Never two owners, no double escalation (`FOR UPDATE SKIP LOCKED`)
- F3.9 Escalation alert outside the app → M10
- Q5 Correct under concurrent events and server restart (timers live in DB)

## M5 · Audit history
- F4.1 Records assignment, ack, escalation, reassignment, role/permission changes, config changes, integration changes, deletions — actor, time, target, before/after
- F4.2 Audit page only for `audit.view`; filter by event type, user, date
- F4.3 No edit/delete anywhere (triggers block UPDATE/DELETE/TRUNCATE)
- API writes must `set_config('app.actor', <member id>, true)` first

## M6 · Operational dashboard
- F5.1 New leads today, open pipeline value by stage, avg time to first response, recovery queue count, escalations (24h), availability, upcoming appointments, payments this month (`dashboard_metrics()`)
- F5.2 / Q12 Same definitions everywhere (Section 7 glossary)
- F5.3 Click 3+ figures → filtered list
- F5.4 User sees personal figures; Owner/Admin company-wide
- F5.5 Show/hide figures, remembered (`members.dashboard_prefs`)

## M7 · Messaging: Twilio WhatsApp sandbox
- I1.1 Inbound webhook → conversation view
- I1.2 Verify `X-Twilio-Signature`; reject + record forged requests
- I1.3 Reply from the platform
- I1.4 Delivery status callbacks (sent / delivered / failed)
- I1.5 Match known number to contact; unknown → new contact + lead (F3.1)
- I1.6 Conversation shows owner; visibility by permission
- I1.7 Failed sends stay visible with reason + retry
- I1.8 Duplicate webhook does not duplicate message or lead (unique `external_id`)
- I1.9 Opted-out contacts cannot be messaged

## M8 · Payments: Stripe test mode
- I2.1 Checkout session / payment link from an opportunity
- I2.2 Webhook updates payment status live (no refresh)
- I2.3 Verify `Stripe-Signature` before any change
- I2.4 Idempotent on event id
- I2.5 Expired, abandoned, failed, refunded states
- I2.6 Collected vs projected revenue; dashboard uses collected only
- I2.7 Payment shows opportunity, contact, requester, Stripe reference
- I2.8 No card data stored or logged

## M9 · Calendar: Google Calendar OAuth 2.0
- I3.1 Connect / disconnect own Google account
- I3.2 Server-side tokens, auto refresh, detect revoked → "needs reconnect"
- I3.3 Book appointment → real Google event + customer record
- I3.4 Read free/busy, prevent or warn on overlaps
- I3.5 Store UTC, display in employee time zone
- I3.6 Reschedule / cancel updates Google event + activity history
- I3.7 Admins see connection status; unconnected employee cannot be booked

**M9 implementation notes**
- Each employee connects their own Google account from Integrations (`POST /api/calendar/connect` returns the consent URL; Google redirects to `GET /api/calendar/callback`, protected by a signed 10-minute `state`).
- Tokens: AES-256-GCM in `integration_secrets` (`TOKEN_ENCRYPTION_KEY`), refreshed automatically; `invalid_grant`/401 flips the member to `needs_reconnect` (shown in the UI).
- Booking checks Google free/busy + platform appointments (409 with the conflicts unless `force`), creates the event with a deterministic id (retry-safe), then inserts the row; an exclusion constraint stops two normal bookings taking one slot.
- Times: stored as UTC `timestamptz`; the booking zone is kept on the row; the employee's zone is read from their Google calendar on connect (`members.timezone`).
- Needs migration 0019 applied before the calendar endpoints work (they fail alone; the rest of the app is unaffected).

## M10 · Notifications: transactional email (I4 choice)
- I4.1 New owner gets an email within the minute of escalation
- I4.2 Email names lead, source, escalation reason, link to the lead
- I4.3 Each employee sets their own destination (`members.notify_destination`)
- I4.4 Failed alerts recorded, retried a limited number of times, visible to Admins (`notification_outbox`)
- Already built: `emails` table (0011), `packages/queue`, `apps/worker` (BullMQ + nodemailer, Gmail SMTP)
- To do: hook escalation → `notification_outbox` / `emails` → queue; Admin view of failures
- Note: the statement lists Resend / SendGrid / Mailgun as examples; Gmail SMTP works but confirm it's accepted

## M11 · Integrations hub (shared by M7–M10)
- I5.1 One page: status (not connected / connected / error), last success, recent errors
- I5.2 Per-workspace credentials (`integrations`, `integration_secrets`)
- I5.3 Secrets never sent to browser, never committed, masked in UI
- I5.4 Sync history of every inbound event / outbound call (`integration_events`)
- I5.5 Retry temporary errors with delay; plain-language permanent errors
- I5.6 Each integration states its limits (e.g. sandbox only reaches joined phones)
- I5.7 Only `integrations.manage` can change; changes audited
- I5.8 One provider down never breaks the rest

## M12 · Quality & UX (applies to every module)
- Q3 Server-side validation; XSS / injection / CSRF protection
- Q4 No orphaned data; concurrent edits detected
- Q7 Responsive on phone, tablet, laptop
- Q8 Keyboard access, labelled forms, contrast, not color-only
- Q9 Pagination for hundreds of records; non-blocking search
- Q10 Loading, success and error states with useful messages

---

## Suggested build order
1. **M0 + M1** — real auth and API skeleton. Everything else needs a logged-in user and a workspace.
2. **M2 + M4** in parallel — real CRM data and the lead engine (the core of the judging).
3. **M3, M5, M11** — customization, audit page, integrations hub.
4. **M7, M8, M9, M10** in parallel — one person per integration, all on top of M11.
5. **M6** — dashboard last, once real leads, payments and appointments exist.
6. **M12** — check continuously; final pass before demo.
