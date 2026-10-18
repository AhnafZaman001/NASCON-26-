-- NASCON '26 : core schema
-- Tenancy (workspace_id everywhere + RLS), RBAC, CRM, lead engine,
-- integrations plumbing, tamper-proof audit log, dashboard metrics.
-- All writes go through the Next.js server (service role) after a permission
-- check; RLS guarantees that browser clients can only READ their own workspace.

create extension if not exists pgcrypto;

-- ───────────────────────────── enums ─────────────────────────────
create type base_level   as enum ('owner', 'admin', 'user');
create type availability as enum ('available', 'busy', 'on_leave', 'offline');
create type lead_status  as enum ('unacknowledged', 'acknowledged', 'closed');

-- ───────────────────────── tenancy & access ──────────────────────
create table workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  settings   jsonb not null default '{
    "ack_window_seconds": 300,
    "max_open_leads": 10,
    "idle_seconds": 86400,
    "escalation_chain": [
      {"step": "next",    "window_seconds": 300},
      {"step": "backup",  "window_seconds": 300},
      {"step": "manager", "window_seconds": 300}
    ],
    "backup_member_id": null,
    "manager_member_id": null
  }'::jsonb,
  created_at timestamptz not null default now()
);

create table roles (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  permissions  text[] not null default '{}',
  created_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

create table members (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  user_id            uuid not null unique references auth.users(id) on delete cascade,
  email              text not null,
  full_name          text not null default '',
  level              base_level not null default 'user',
  role_id            uuid references roles(id) on delete set null,
  status             availability not null default 'available',
  last_assigned_at   timestamptz,
  notify_channel     text check (notify_channel in ('telegram', 'slack', 'email')),
  notify_destination text,
  calendar_status    text not null default 'not_connected'
                     check (calendar_status in ('not_connected', 'connected', 'needs_reconnect')),
  dashboard_prefs    jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
create index members_ws_idx on members (workspace_id);

-- helpers used by RLS and server functions
create function current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from members where user_id = auth.uid() limit 1
$$;

create function current_workspace_id() returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from members where user_id = auth.uid() limit 1
$$;

-- Owner holds every permission; everyone else gets exactly what their role grants.
create function has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select m.level = 'owner' or p = any (coalesce(r.permissions, '{}'))
    from members m left join roles r on r.id = m.role_id
    where m.user_id = auth.uid()
  ), false)
$$;

-- ───────────────────────────── CRM ───────────────────────────────
create table companies (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  domain       text,
  custom       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create table contacts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  company_id   uuid references companies(id) on delete set null,
  owner_id     uuid references members(id) on delete set null,
  full_name    text not null,
  email        text,
  phone        text,
  tags         text[] not null default '{}',
  opted_out    boolean not null default false,
  source       text,
  custom       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index contacts_ws_phone_uq on contacts (workspace_id, phone) where phone is not null;
create index contacts_ws_idx on contacts (workspace_id, created_at desc);

create table pipelines (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);

create table stages (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  pipeline_id         uuid not null references pipelines(id) on delete cascade,
  name                text not null,
  position            int not null default 0,
  kind                text not null default 'open' check (kind in ('open', 'won', 'lost')),
  required_field_ids  uuid[] not null default '{}'
);
create index stages_pipeline_idx on stages (pipeline_id, position);

-- pipeline_id null = field applies to every pipeline
create table field_definitions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity       text not null check (entity in ('contact', 'company', 'opportunity')),
  pipeline_id  uuid references pipelines(id) on delete cascade,
  name         text not null,
  type         text not null check (type in ('text', 'number', 'date', 'dropdown', 'checkbox')),
  options      jsonb not null default '[]'::jsonb,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);

create table opportunities (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  contact_id     uuid not null references contacts(id) on delete cascade,
  pipeline_id    uuid not null references pipelines(id) on delete restrict,
  stage_id       uuid not null references stages(id) on delete restrict,
  title          text not null,
  value          numeric(14, 2) not null default 0,
  currency       text not null default 'usd',
  owner_id       uuid references members(id) on delete set null,
  custom         jsonb not null default '{}'::jsonb,
  payment_status text not null default 'unpaid'
                 check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'expired', 'refunded')),
  version        int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index opp_ws_stage_idx on opportunities (workspace_id, stage_id);
create index opp_contact_idx  on opportunities (contact_id);

create table saved_lists (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  owner_id     uuid references members(id) on delete set null,
  name         text not null,
  entity       text not null default 'contact' check (entity in ('contact', 'opportunity')),
  filters      jsonb not null default '[]'::jsonb,   -- evaluated live, so lists update themselves
  created_at   timestamptz not null default now()
);

-- ───────────────────────── lead engine ───────────────────────────
create table leads (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  contact_id        uuid not null references contacts(id) on delete cascade,
  opportunity_id    uuid references opportunities(id) on delete set null,
  source            text not null check (source in ('web_form', 'whatsapp', 'sms', 'manual')),
  note              text,
  status            lead_status not null default 'unacknowledged',
  owner_id          uuid references members(id) on delete set null,   -- exactly one owner at a time
  assigned_at       timestamptz,
  first_assigned_at timestamptz,
  ack_deadline      timestamptz,
  acknowledged_at   timestamptz,
  first_ack_at      timestamptz,
  escalation_level  int not null default 0,
  escalation_count  int not null default 0,
  tried_member_ids  uuid[] not null default '{}',
  recovery_flag     text,
  last_action_at    timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index leads_due_idx   on leads (ack_deadline) where status = 'unacknowledged';
create index leads_owner_idx on leads (owner_id, status);
create index leads_ws_idx    on leads (workspace_id, created_at desc);

create table lead_assignments (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id      uuid not null references leads(id) on delete cascade,
  from_member  uuid references members(id) on delete set null,
  to_member    uuid references members(id) on delete set null,
  reason       text not null check (reason in ('initial', 'escalation', 'absence', 'manual')),
  created_at   timestamptz not null default now()
);
create index lead_assign_lead_idx on lead_assignments (lead_id, created_at);

create table activities (
  id             bigint generated always as identity primary key,
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  contact_id     uuid references contacts(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  lead_id        uuid references leads(id) on delete cascade,
  actor_id       uuid references members(id) on delete set null,   -- null = system
  type           text not null,   -- note, stage_change, assignment, field_edit, message, payment, appointment
  data           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index activities_contact_idx on activities (contact_id, created_at desc);
create index activities_opp_idx     on activities (opportunity_id, created_at desc);

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

-- ─────────────────────── audit (append only) ─────────────────────
create table audit_log (
  id           bigint generated always as identity primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  actor_id     uuid,                       -- member id; null with actor_type 'system'
  actor_type   text not null default 'user' check (actor_type in ('user', 'system')),
  event_type   text not null,
  target_type  text,
  target_id    text,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);
create index audit_ws_idx on audit_log (workspace_id, created_at desc);

create function audit_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_immutable();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function audit_log_immutable();

-- The server may set  select set_config('app.actor', '<member uuid>', true)  before writing
-- so triggers attribute changes to the right person even when using the service role.
create function audit(p_ws uuid, p_event text, p_type text, p_target text, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  a := coalesce(nullif(current_setting('app.actor', true), '')::uuid, current_member_id());
  insert into audit_log (workspace_id, actor_id, actor_type, event_type, target_type, target_id, before, after)
  values (p_ws, a, case when a is null then 'system' else 'user' end, p_event, p_type, p_target, p_before, p_after);
end $$;

create function audit_trigger() returns trigger language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; j jsonb;
begin
  if tg_op = 'DELETE' then o := to_jsonb(old);
  elsif tg_op = 'INSERT' then n := to_jsonb(new);
  else
    o := to_jsonb(old); n := to_jsonb(new);
    if o = n then return new; end if;
  end if;
  j := coalesce(n, o);
  perform audit(coalesce((j->>'workspace_id'), (j->>'id'))::uuid,
                tg_table_name || '.' || lower(tg_op), tg_table_name, j->>'id', o, n);
  return coalesce(new, old);
end $$;

create trigger audit_workspaces    after update of settings, name        on workspaces         for each row execute function audit_trigger();
create trigger audit_roles         after insert or update or delete     on roles              for each row execute function audit_trigger();
create trigger audit_members       after insert or update of level, role_id or delete on members for each row execute function audit_trigger();
create trigger audit_pipelines     after insert or update or delete     on pipelines          for each row execute function audit_trigger();
create trigger audit_stages        after insert or update or delete     on stages             for each row execute function audit_trigger();
create trigger audit_fields        after insert or update or delete     on field_definitions  for each row execute function audit_trigger();
create trigger audit_integrations  after insert or update of status or delete on integrations for each row execute function audit_trigger();
create trigger audit_del_contacts  after delete on contacts       for each row execute function audit_trigger();
create trigger audit_del_opps      after delete on opportunities  for each row execute function audit_trigger();
create trigger audit_del_companies after delete on companies      for each row execute function audit_trigger();

-- ─────────────────── data-integrity triggers ─────────────────────
create function opportunity_guard() returns trigger language plpgsql as $$
declare s stages; missing text;
begin
  select * into s from stages where id = new.stage_id;
  if s.pipeline_id <> new.pipeline_id then
    raise exception 'Stage "%" does not belong to this pipeline.', s.name using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    select string_agg(fd.name, ', ') into missing
    from field_definitions fd
    where fd.id = any (s.required_field_ids)
      and coalesce(new.custom ->> fd.id::text, '') = '';
    if missing is not null then
      raise exception 'Cannot move to "%": fill in required fields first (%).', s.name, missing
        using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;   -- app updates with  WHERE version = n  to detect concurrent edits
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger opportunity_guard_trg before insert or update on opportunities
  for each row execute function opportunity_guard();

-- Deleting a stage that still holds opportunities requires an explicit destination.
create function delete_stage(p_stage uuid, p_move_to uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare s stages; dest stages; cnt int;
begin
  select * into s from stages where id = p_stage for update;
  if not found then raise exception 'Stage not found.'; end if;
  select count(*) into cnt from opportunities where stage_id = p_stage;
  if cnt > 0 then
    if p_move_to is null then
      raise exception 'Stage "%" holds % opportunities. Choose a stage to move them to.', s.name, cnt using errcode = 'P0001';
    end if;
    select * into dest from stages where id = p_move_to and pipeline_id = s.pipeline_id and id <> p_stage;
    if not found then raise exception 'Destination stage must be another stage in the same pipeline.'; end if;
    update opportunities set stage_id = p_move_to where stage_id = p_stage;
  end if;
  delete from stages where id = p_stage;
end $$;

-- ───────────────────── lead engine functions ─────────────────────
create function open_lead_count(p_member uuid) returns int language sql stable as $$
  select count(*)::int from leads where owner_id = p_member and status in ('unacknowledged', 'acknowledged')
$$;

-- Round-robin among Available members under the open-lead cap. Locks the winner so that
-- two concurrent assignments cannot pick (and overload) the same person.
create function pick_assignee(p_ws uuid, p_exclude uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare mx int; r uuid;
begin
  select coalesce((settings ->> 'max_open_leads')::int, 10) into mx from workspaces where id = p_ws;
  select m.id into r from members m
  where m.workspace_id = p_ws
    and m.status = 'available'
    and m.id <> all (coalesce(p_exclude, '{}'))
    and open_lead_count(m.id) < mx
  order by m.last_assigned_at nulls first, m.created_at
  limit 1
  for update of m skip locked;
  return r;
end $$;

create function assign_lead(p_lead uuid, p_reason text, p_target uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare l leads; w workspaces; tgt uuid; win int;
begin
  select * into l from leads where id = p_lead for update;     -- one writer per lead
  if not found then return null; end if;
  select * into w from workspaces where id = l.workspace_id;

  tgt := p_target;
  if tgt is not null and not exists (select 1 from members where id = tgt and workspace_id = l.workspace_id) then
    raise exception 'Target is not a member of this workspace.';
  end if;
  if tgt is null then tgt := pick_assignee(l.workspace_id, l.tried_member_ids); end if;
  if tgt is null then   -- nobody eligible: fall back to the designated manager / backup
    tgt := coalesce((w.settings ->> 'manager_member_id')::uuid, (w.settings ->> 'backup_member_id')::uuid);
  end if;

  win := coalesce(
    case when l.escalation_level > 0
      then (w.settings -> 'escalation_chain' -> (l.escalation_level - 1) ->> 'window_seconds')::int end,
    (w.settings ->> 'ack_window_seconds')::int, 300);

  update leads set
    owner_id          = tgt,
    assigned_at       = case when tgt is null then assigned_at else now() end,
    first_assigned_at = coalesce(first_assigned_at, case when tgt is not null then now() end),
    ack_deadline      = case when tgt is null then null else now() + make_interval(secs => win) end,
    status            = 'unacknowledged',
    acknowledged_at   = null,
    recovery_flag     = null,
    tried_member_ids  = case when tgt is null or tgt = any (tried_member_ids)
                             then tried_member_ids else array_append(tried_member_ids, tgt) end,
    updated_at        = now()
  where id = p_lead;

  if tgt is not null then
    update members  set last_assigned_at = now() where id = tgt;
    update contacts set owner_id = tgt           where id = l.contact_id;
    insert into notification_outbox (workspace_id, member_id, lead_id, reason, payload)
    values (l.workspace_id, tgt, p_lead, p_reason,
            jsonb_build_object('source', l.source, 'escalation_level', l.escalation_level));
  end if;

  insert into lead_assignments (workspace_id, lead_id, from_member, to_member, reason)
  values (l.workspace_id, p_lead, l.owner_id, tgt, p_reason);
  insert into activities (workspace_id, contact_id, lead_id, actor_id, type, data)
  values (l.workspace_id, l.contact_id, p_lead, null, 'assignment',
          jsonb_build_object('reason', p_reason, 'from', l.owner_id, 'to', tgt));
  perform audit(l.workspace_id, 'lead.' || case p_reason when 'initial' then 'assigned'
                when 'escalation' then 'escalated' when 'absence' then 'reassigned_absence' else 'reassigned_manual' end,
                'lead', p_lead::text,
                jsonb_build_object('owner_id', l.owner_id),
                jsonb_build_object('owner_id', tgt, 'reason', p_reason));
  return tgt;
end $$;

create function leads_after_insert() returns trigger language plpgsql as $$
begin
  perform assign_lead(new.id, 'initial');
  return new;
end $$;
create trigger leads_assign_on_insert after insert on leads
  for each row execute function leads_after_insert();

-- Acknowledge, or any recorded action on the lead (note, message, call, stage change…).
create function acknowledge_lead(p_lead uuid, p_member uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare l leads; was_unack boolean;
begin
  select * into l from leads where id = p_lead and owner_id = p_member for update;
  if not found then return false; end if;
  was_unack := l.status = 'unacknowledged';
  update leads set
    status          = case when status = 'unacknowledged' then 'acknowledged' else status end,
    acknowledged_at = coalesce(acknowledged_at, now()),
    first_ack_at    = coalesce(first_ack_at, now()),
    ack_deadline    = null,
    recovery_flag   = null,
    last_action_at  = now(),
    updated_at      = now()
  where id = p_lead;
  if was_unack then
    perform audit(l.workspace_id, 'lead.acknowledged', 'lead', p_lead::text, null,
                  jsonb_build_object('member_id', p_member));
    insert into activities (workspace_id, contact_id, lead_id, actor_id, type)
    values (l.workspace_id, l.contact_id, p_lead, p_member, 'acknowledged');
  end if;
  return true;
end $$;

-- Escalation sweep. SKIP LOCKED + the WHERE re-check after locking means two overlapping runs
-- (or two timers expiring together) can never escalate the same lead twice.
create function escalate_expired_leads() returns int
language plpgsql security definer set search_path = public as $$
declare l leads; w workspaces; chain jsonb; step text; tgt uuid; n int := 0;
begin
  for l in
    select * from leads
    where status = 'unacknowledged' and ack_deadline is not null and ack_deadline < now()
    order by ack_deadline
    for update skip locked
  loop
    select * into w from workspaces where id = l.workspace_id;
    chain := coalesce(w.settings -> 'escalation_chain', '[]'::jsonb);

    if l.escalation_level >= jsonb_array_length(chain) then
      update leads set ack_deadline = null, recovery_flag = 'chain_exhausted', updated_at = now() where id = l.id;
      perform audit(l.workspace_id, 'lead.chain_exhausted', 'lead', l.id::text, null,
                    jsonb_build_object('owner_id', l.owner_id));
      continue;
    end if;

    step := chain -> l.escalation_level ->> 'step';
    tgt := case step
      when 'backup'  then (w.settings ->> 'backup_member_id')::uuid
      when 'manager' then (w.settings ->> 'manager_member_id')::uuid
      else null end;

    update leads set escalation_level = escalation_level + 1,
                     escalation_count = escalation_count + 1 where id = l.id;
    perform assign_lead(l.id, 'escalation', tgt);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Availability change. Leaving "available" immediately reassigns UNACKNOWLEDGED leads.
-- Policy for already-acknowledged leads: they stay with their owner and are shown as
-- "owner away" in the UI (see leads_v.owner_away) so a manager can reassign them.
create function set_member_status(p_member uuid, p_status availability) returns int
language plpgsql security definer set search_path = public as $$
declare m members; l record; n int := 0;
begin
  select * into m from members where id = p_member for update;
  if not found then raise exception 'Member not found.'; end if;
  update members set status = p_status where id = p_member;
  perform audit(m.workspace_id, 'member.status_changed', 'members', p_member::text,
                jsonb_build_object('status', m.status), jsonb_build_object('status', p_status));
  if p_status in ('on_leave', 'offline') then
    for l in select id from leads where owner_id = p_member and status = 'unacknowledged' for update skip locked loop
      perform assign_lead(l.id, 'absence');
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;

create function reassign_lead(p_lead uuid, p_to uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return assign_lead(p_lead, 'manual', p_to);
end $$;

-- ───────────────────────────── views ─────────────────────────────
-- Opportunity value is masked server-side for users without 'values.view'.
create view opportunities_v as
select o.id, o.workspace_id, o.contact_id, o.pipeline_id, o.stage_id, o.title,
       case when has_perm('values.view') then o.value end as value,
       o.currency, o.owner_id, o.custom, o.payment_status, o.version, o.created_at, o.updated_at
from opportunities o
where o.workspace_id = current_workspace_id() and has_perm('crm.view');

create view recovery_queue_v as
select * from (
  select l.id, l.workspace_id, l.contact_id, l.owner_id, l.source, l.status,
         l.assigned_at, l.ack_deadline, l.escalation_count, l.last_action_at,
         array_remove(array[
           case when l.owner_id is null then 'no_available_owner' end,
           case when l.status = 'unacknowledged'
                 and (l.recovery_flag is not null or l.ack_deadline < now()) then 'unacknowledged_past_window' end,
           case when l.escalation_count >= 2 then 'escalated_multiple_times' end,
           case when l.last_action_at < now() - make_interval(secs =>
                  coalesce((select (w.settings ->> 'idle_seconds')::int from workspaces w where w.id = l.workspace_id), 86400))
                then 'idle' end
         ], null) as reasons
  from leads l
  where l.workspace_id = current_workspace_id() and has_perm('crm.view') and l.status <> 'closed'
) q where cardinality(reasons) > 0;

create view leads_v as
select l.*, (m.status is not null and m.status <> 'available') as owner_away
from leads l left join members m on m.id = l.owner_id
where l.workspace_id = current_workspace_id() and has_perm('crm.view');

-- One definition of every dashboard figure (spec §7). Personal scope for users without
-- 'dashboard.company'; revenue and values only for users with 'values.view'.
create function dashboard_metrics() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m members; ws uuid; company boolean; vals boolean;
begin
  select * into m from members where user_id = auth.uid();
  if m.id is null then raise exception 'Not a workspace member.'; end if;
  ws := m.workspace_id; company := has_perm('dashboard.company'); vals := has_perm('values.view');

  return jsonb_build_object(
    'scope', case when company then 'company' else 'personal' end,
    'new_leads_today', (select count(*) from leads l
       where l.workspace_id = ws and l.created_at >= date_trunc('day', now()) and (company or l.owner_id = m.id)),
    'avg_first_response_seconds', (select avg(extract(epoch from l.first_ack_at - l.first_assigned_at)) from leads l
       where l.workspace_id = ws and l.first_ack_at is not null and (company or l.owner_id = m.id)),
    'recovery_queue', (select count(*) from recovery_queue_v r where company or r.owner_id = m.id),
    'escalations_24h', (select count(*) from lead_assignments a
       where a.workspace_id = ws and a.reason = 'escalation' and a.created_at > now() - interval '24 hours'),
    'availability', (select coalesce(jsonb_object_agg(status, c), '{}'::jsonb)
       from (select status, count(*) c from members where workspace_id = ws group by status) t),
    'upcoming_appointments', (select count(*) from appointments ap
       where ap.workspace_id = ws and ap.status = 'scheduled' and ap.starts_at > now() and (company or ap.member_id = m.id)),
    'collected_revenue_month', case when vals then (select coalesce(sum(p.amount - p.refunded_amount), 0) from payments p
       where p.workspace_id = ws and p.paid_at >= date_trunc('month', now())
         and p.status in ('paid', 'partially_refunded', 'refunded') and (company or p.requested_by = m.id)) end,
    'pipeline_by_stage', (select coalesce(jsonb_agg(jsonb_build_object(
         'stage_id', s.id, 'stage', s.name, 'pipeline_id', s.pipeline_id, 'count', x.cnt,
         'value', case when vals then x.val end) order by s.position), '[]'::jsonb)
       from stages s
       left join lateral (select count(*) cnt, coalesce(sum(o.value), 0) val from opportunities o
                          where o.stage_id = s.id and (company or o.owner_id = m.id)) x on true
       where s.workspace_id = ws and s.kind = 'open')
  );
end $$;

-- ───────────────────────── onboarding ────────────────────────────
-- Called by the server (service role) right after auth signup.
create function bootstrap_workspace(p_user uuid, p_name text, p_email text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid; pl uuid; all_perms text[] := array[
  'crm.view','crm.create','crm.edit','crm.delete','crm.export','values.view','assignment.manage',
  'integrations.manage','audit.view','users.manage','pipelines.manage','conversations.view_all',
  'dashboard.company','leads.manage'];
begin
  insert into workspaces (name) values (p_name) returning id into ws;
  insert into roles (workspace_id, name, permissions) values
    (ws, 'Admin',   all_perms),
    (ws, 'Manager', array['crm.view','crm.create','crm.edit','crm.export','values.view','conversations.view_all','dashboard.company','leads.manage']),
    (ws, 'Sales',   array['crm.view','crm.create','crm.edit']);
  insert into members (workspace_id, user_id, email, full_name, level)
    values (ws, p_user, p_email, p_full_name, 'owner');
  insert into pipelines (workspace_id, name, position) values (ws, 'Sales', 0) returning id into pl;
  insert into stages (workspace_id, pipeline_id, name, position, kind) values
    (ws, pl, 'New',        0, 'open'),
    (ws, pl, 'Qualified',  1, 'open'),
    (ws, pl, 'Proposal',   2, 'open'),
    (ws, pl, 'Won',        3, 'won'),
    (ws, pl, 'Lost',       4, 'lost');
  insert into integrations (workspace_id, provider)
    select ws, unnest(array['twilio','stripe','google_calendar','telegram']);
  return ws;
end $$;

-- ─────────────────────── privileges & RLS ────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant execute on function current_member_id(), current_workspace_id(), has_perm(text), dashboard_metrics()
  to authenticated;

do $$
declare t text;
begin
  -- read-only access for signed-in users, gated by RLS
  foreach t in array array['workspaces','roles','members','companies','contacts','pipelines','stages',
    'field_definitions','opportunities','saved_lists','leads','lead_assignments','activities',
    'messages','payments','appointments','integrations','integration_events','notification_outbox',
    'audit_log','integration_secrets']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;

  foreach t in array array['workspaces','roles','members','companies','contacts','pipelines','stages',
    'field_definitions','saved_lists','leads','lead_assignments','activities','messages','payments',
    'appointments','integrations','integration_events','notification_outbox','audit_log']
  loop
    execute format('grant select on %I to authenticated', t);
  end loop;

  alter table opportunities enable row level security;
end $$;

-- opportunity.value is never selectable directly; clients read opportunities_v instead
grant select (id, workspace_id, contact_id, pipeline_id, stage_id, title, currency, owner_id, custom,
              payment_status, version, created_at, updated_at) on opportunities to authenticated;
grant select on opportunities_v, recovery_queue_v, leads_v to authenticated;

create policy ws_read on workspaces for select to authenticated using (id = current_workspace_id());
create policy members_read on members for select to authenticated using (workspace_id = current_workspace_id());
create policy roles_read   on roles   for select to authenticated using (workspace_id = current_workspace_id());

do $$
declare t text;
begin
  foreach t in array array['companies','contacts','pipelines','stages','field_definitions','opportunities',
    'saved_lists','leads','lead_assignments','activities','payments','appointments']
  loop
    execute format($f$create policy %I on %I for select to authenticated
      using (workspace_id = current_workspace_id() and has_perm('crm.view'))$f$, t || '_read', t);
  end loop;
end $$;

create policy messages_read on messages for select to authenticated using (
  workspace_id = current_workspace_id() and has_perm('crm.view')
  and (has_perm('conversations.view_all')
       or exists (select 1 from contacts c where c.id = messages.contact_id and c.owner_id = current_member_id())));

create policy integrations_read on integrations for select to authenticated
  using (workspace_id = current_workspace_id() and has_perm('integrations.manage'));
create policy integration_events_read on integration_events for select to authenticated
  using (workspace_id = current_workspace_id() and has_perm('integrations.manage'));
create policy outbox_read on notification_outbox for select to authenticated
  using (workspace_id = current_workspace_id() and has_perm('integrations.manage'));
create policy audit_read on audit_log for select to authenticated
  using (workspace_id = current_workspace_id() and has_perm('audit.view'));

-- service role keeps full access (server code); make that explicit for functions
grant execute on all functions in schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ───────────────────── realtime & scheduler ──────────────────────
do $$
begin
  alter publication supabase_realtime add table leads, messages, activities, payments, appointments;
exception when others then
  raise notice 'realtime publication not configured: %', sqlerrm;
end $$;

-- escalation sweep every 10 seconds (timers survive server restarts: state lives in the DB)
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('nascon-escalate', '10 seconds', 'select public.escalate_expired_leads()');
exception when others then
  raise notice 'pg_cron not enabled - enable it in Dashboard > Database > Extensions, then run: select cron.schedule(''nascon-escalate'',''10 seconds'',''select public.escalate_expired_leads()''); (%)', sqlerrm;
end $$;
