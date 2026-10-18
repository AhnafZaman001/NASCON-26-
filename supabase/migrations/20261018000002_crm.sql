-- 0002 CRM
-- Needs: 0001. Creates: companies, contacts, pipelines, stages, field_definitions, opportunities, saved_lists,
-- stage-requirement guard, delete_stage().

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

