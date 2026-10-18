-- 0005 Integrations plumbing
-- Needs: 0001. Creates: integrations, integration_secrets (service role only), integration_events, notification_outbox.

-- ───────────────────────── integrations ──────────────────────────
create table integrations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  provider      text not null check (provider in ('twilio', 'stripe', 'google_calendar', 'telegram', 'slack', 'email')),
  status        text not null default 'not_connected' check (status in ('not_connected', 'connected', 'error')),
  public_config jsonb not null default '{}'::jsonb,   -- NON-secret only (e.g. sandbox number)
  last_ok_at    timestamptz,
  last_error    text,
  updated_at    timestamptz not null default now(),
  unique (workspace_id, provider)
);

-- Ciphertext only. No grants and no policies: reachable solely by the service role.
create table integration_secrets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider     text not null,
  member_id    uuid references members(id) on delete cascade,   -- per-employee OAuth tokens
  ciphertext   text not null,
  updated_at   timestamptz not null default now(),
  unique nulls not distinct (workspace_id, provider, member_id)
);

create table integration_events (
  id           bigint generated always as identity primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  provider     text not null,
  direction    text not null check (direction in ('inbound', 'outbound')),
  event_type   text not null,
  external_id  text,                       -- provider event/message id → idempotency key
  status       text not null default 'ok' check (status in ('ok', 'error', 'rejected', 'duplicate')),
  reference    text,
  error        text,
  payload      jsonb,
  created_at   timestamptz not null default now()
);
create unique index integration_events_idem_uq
  on integration_events (provider, direction, external_id, event_type)
  where external_id is not null and status <> 'duplicate' and status <> 'rejected';
create index integration_events_ws_idx on integration_events (workspace_id, created_at desc);

create table notification_outbox (
  id              bigint generated always as identity primary key,
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  member_id       uuid not null references members(id) on delete cascade,
  lead_id         uuid references leads(id) on delete cascade,
  reason          text not null,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now()
);
create index outbox_due_idx on notification_outbox (next_attempt_at) where status = 'pending';

