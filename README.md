# Lead Shield · NASCON '26 Web Dev

Unified business platform: customizable CRM + guaranteed lead ownership (assign → acknowledge → escalate → recover) + messaging, payments and calendar integrations + audit trail.

```
apps/web      Next.js 16 (App Router, TypeScript, Tailwind v4)
packages/ui   Shared constants
```

## Run
```
npm install
cp apps/web/.env.example apps/web/.env.local
npm run dev            # http://localhost:3000
npm run build && npm run lint
npm run test:engine -w @nascon/web   # assignment/escalation/permission logic checks
```
Demo login: pick any account on `/login` (password for typed login: `demo1234`). The sidebar's **Demo: switch user** lets you act as Owner, Admin, Manager or User without logging out. The public lead form is at `/capture`.

## Architecture
| Layer | Where |
|---|---|
| Types / seed data | `src/lib/types.ts`, `src/lib/seed.ts` |
| **Data + business rules (swap point)** | `src/lib/store.ts` |
| Permission helpers | `src/lib/app.ts` |
| UI primitives | `src/components/ui.tsx` |
| Pages | `src/app/(app)/*` (dashboard, leads, pipeline, contacts, inbox, payments, calendar, integrations, audit, settings) |

**Current state:** the frontend runs against a local store (`store.ts`, persisted in `localStorage`, synced across tabs). Every mutation is an exported action, so wiring Supabase / route handlers means replacing action bodies, not touching pages. Provider events (Twilio/Stripe webhooks, Google OAuth) are **simulated** in the UI and labelled "demo"; the real signature checks, idempotency keys and secret handling must live in server route handlers (spec I1.2, I2.3, I5.3). UI permission checks are convenience only: the server must enforce them (F1.5, Q2).

## Spec coverage map
F1 roles/permissions/field masking · F2 pipelines, custom fields, stage-required fields, saved lists, activity, 360 contact view · F3 capture, availability, round-robin + cap, ack window, escalation chain, reassignment on absence, recovery queue, double-escalation guard · F4 audit log (read-only) · F5 role-aware dashboard with drill-down and show/hide · I1–I5 integration pages, sync history, failure/retry/opt-out states.
