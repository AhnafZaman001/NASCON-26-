-- 0006 Audit (append-only)
-- Needs: 0001-0005. Creates: audit_log, tamper-blocking triggers, audit(), audit_trigger() and triggers on config tables.

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

