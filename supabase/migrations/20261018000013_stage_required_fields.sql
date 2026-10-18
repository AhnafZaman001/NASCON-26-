-- 0013 stage_required_fields
-- Needs: 0002, 0006, 0008. Replaces stages.required_field_ids (uuid[]) with a join table so every
-- required field is a real foreign key: deleting a field or stage cleans up automatically (Q4),
-- and each change is audited (F4.1). Powers stage-specific required fields (F2.4).

create table stage_required_fields (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  stage_id     uuid not null references stages(id) on delete cascade,
  field_id     uuid not null references field_definitions(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (stage_id, field_id)
);
create index stage_required_fields_field_idx on stage_required_fields (field_id);

-- The field must be an opportunity field of the same workspace that applies to the stage's pipeline.
create function stage_required_fields_guard() returns trigger language plpgsql as $$
declare s stages; f field_definitions;
begin
  select * into s from stages where id = new.stage_id;
  select * into f from field_definitions where id = new.field_id;
  if s.workspace_id <> new.workspace_id or f.workspace_id <> new.workspace_id then
    raise exception 'Stage and field must belong to this workspace.' using errcode = 'P0001';
  end if;
  if f.entity <> 'opportunity' then
    raise exception 'Only opportunity fields can be required by a stage ("%" is a % field).', f.name, f.entity
      using errcode = 'P0001';
  end if;
  if f.pipeline_id is not null and f.pipeline_id <> s.pipeline_id then
    raise exception 'Field "%" belongs to a different pipeline than stage "%".', f.name, s.name using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger stage_required_fields_guard_trg before insert or update on stage_required_fields
  for each row execute function stage_required_fields_guard();

-- Carry over anything already stored in the old array column (skips ids that no longer exist).
insert into stage_required_fields (workspace_id, stage_id, field_id)
select s.workspace_id, s.id, fd.id
from stages s
cross join lateral unnest(s.required_field_ids) as r(field_id)
join field_definitions fd on fd.id = r.field_id and fd.workspace_id = s.workspace_id and fd.entity = 'opportunity'
on conflict (stage_id, field_id) do nothing;

-- Same rules as before, now reading the join table.
create or replace function opportunity_guard() returns trigger language plpgsql as $$
declare s stages; missing text;
begin
  select * into s from stages where id = new.stage_id;
  if s.pipeline_id <> new.pipeline_id then
    raise exception 'Stage "%" does not belong to this pipeline.', s.name using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    select string_agg(fd.name, ', ' order by fd.position) into missing
    from stage_required_fields srf
    join field_definitions fd on fd.id = srf.field_id
    where srf.stage_id = new.stage_id
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

alter table stages drop column required_field_ids;

create trigger audit_stage_required_fields after insert or delete on stage_required_fields
  for each row execute function audit_trigger();

-- ─────────────────────────── privileges ──────────────────────────
alter table stage_required_fields enable row level security;
grant select on stage_required_fields to authenticated;
create policy stage_required_fields_read on stage_required_fields for select to authenticated
  using (workspace_id = current_workspace_id() and has_perm('crm.view'));

revoke all on function stage_required_fields_guard() from public, anon, authenticated;
grant all on stage_required_fields to service_role;
