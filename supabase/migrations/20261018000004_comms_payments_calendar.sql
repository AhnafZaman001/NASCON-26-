-- 0004 Messages, payments, appointments
-- Needs: 0001-0003.

-- ───────────────── messages / payments / appointments ────────────
create table messages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  lead_id      uuid references leads(id) on delete set null,
  channel      text not null default 'whatsapp' check (channel in ('whatsapp', 'sms')),
  direction    text not null check (direction in ('inbound', 'outbound')),
  body         text not null,
  status       text not null default 'queued'
               check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  provider_sid text,
  error        text,
  sent_by      uuid references members(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index messages_sid_uq on messages (workspace_id, provider_sid) where provider_sid is not null;
create index messages_contact_idx on messages (contact_id, created_at);

create table payments (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  opportunity_id     uuid not null references opportunities(id) on delete cascade,
  contact_id         uuid not null references contacts(id) on delete cascade,
  requested_by       uuid references members(id) on delete set null,
  amount             numeric(14, 2) not null check (amount > 0),
  currency           text not null default 'usd',
  status             text not null default 'pending'
                     check (status in ('pending', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded')),
  refunded_amount    numeric(14, 2) not null default 0,
  checkout_url       text,
  stripe_session_id  text,
  stripe_payment_ref text,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index payments_session_uq on payments (stripe_session_id) where stripe_session_id is not null;

create table appointments (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete cascade,
  opportunity_id  uuid references opportunities(id) on delete set null,
  member_id       uuid not null references members(id) on delete cascade,
  title           text not null,
  starts_at       timestamptz not null,    -- stored in UTC; display zone kept separately
  ends_at         timestamptz not null,
  timezone        text not null default 'UTC',
  google_event_id text,
  status          text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index appt_member_time_idx on appointments (member_id, starts_at);

