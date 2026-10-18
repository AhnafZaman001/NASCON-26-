# Database

Ten ordered migrations build the core schema. `checks.sql` verifies it; `demo_seed.sql` adds demo data after first signup.

## Apply
```
supabase login
supabase link --project-ref bjbwdtlznujrresmhhyv     # prompts for the DB password
supabase db push
```
No CLI? Paste each file in `migrations/` into Dashboard > SQL Editor, in numeric order (0001 -> 0010).
Then run `checks.sql`. After your first signup, run `demo_seed.sql`.

Before running: Dashboard > Database > Extensions > enable **pg_cron** (the migration schedules the
10-second escalation sweep; if pg_cron is off it prints the one-line command to run later).

## Design rules
- Every table carries `workspace_id`; RLS lets browsers READ their own workspace only.
- All writes go through the Next.js server (service role) after a permission check.
- Lead assignment / escalation / absence handling live in SQL functions with row locks (`FOR UPDATE SKIP LOCKED`).
- `audit_log` is append-only (triggers block UPDATE/DELETE/TRUNCATE).
- `opportunities.value` is not directly selectable; read `opportunities_v` (masked without `values.view`).
- `integration_secrets` has no grants: service role only. Store ciphertext, never plaintext.
- Before writing as the service role, call `select set_config('app.actor', '<member uuid>', true)` in the same
  transaction so audit rows name the right person.
