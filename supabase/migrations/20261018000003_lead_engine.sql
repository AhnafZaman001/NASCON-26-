-- 0003 Lead engine
-- Needs: 0001, 0002. Creates: leads, lead_assignments, activities and the assign / acknowledge / escalate /
-- absence / reassign functions. (Functions also use notification_outbox and audit(), created in 0005 / 0006;
-- nothing runs them until all migrations are applied.)

create type lead_status as enum ('unacknowledged', 'acknowledged', 'closed');

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

