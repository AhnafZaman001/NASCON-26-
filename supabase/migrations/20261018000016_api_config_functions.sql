-- 0016 API write functions for CRM customization (M3)
-- Needs: 0002, 0006, 0013, 0014. Each sets app.actor so the audit triggers on pipelines, stages,
-- field_definitions and stage_required_fields name the member. Called only by apps/api (service role).

-- renumber a pipeline's stages 0..n in their current order
create function api_renumber_stages(p_pipeline uuid) returns void language sql as $$
  update stages s set position = r.rn - 1
  from (select id, row_number() over (order by position, id) rn from stages where pipeline_id = p_pipeline) r
  where s.id = r.id and s.position <> r.rn - 1
$$;

create function api_add_pipeline(p_actor uuid, p_ws uuid, p_id uuid, p_name text, p_stage_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform api_set_actor(p_actor);
  insert into pipelines (id, workspace_id, name, position)
    values (p_id, p_ws, trim(p_name), (select coalesce(max(position) + 1, 0) from pipelines where workspace_id = p_ws));
  insert into stages (id, workspace_id, pipeline_id, name, position, kind) values
    (p_stage_ids[1], p_ws, p_id, 'New', 0, 'open'),
    (p_stage_ids[2], p_ws, p_id, 'Won', 1, 'won'),
    (p_stage_ids[3], p_ws, p_id, 'Lost', 2, 'lost');
end $$;

-- new open stage goes before the first won/lost stage
create function api_add_stage(p_actor uuid, p_ws uuid, p_pipeline uuid, p_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare pos int;
begin
  perform api_set_actor(p_actor);
  if not exists (select 1 from pipelines where id = p_pipeline and workspace_id = p_ws) then
    raise exception 'Pipeline not found.' using errcode = 'P0002';
  end if;
  select coalesce(min(position), (select coalesce(max(position) + 1, 0) from stages where pipeline_id = p_pipeline))
    into pos from stages where pipeline_id = p_pipeline and kind <> 'open';
  update stages set position = position + 1 where pipeline_id = p_pipeline and position >= pos;
  insert into stages (id, workspace_id, pipeline_id, name, position, kind) values (p_id, p_ws, p_pipeline, trim(p_name), pos, 'open');
end $$;

create function api_rename_stage(p_actor uuid, p_ws uuid, p_stage uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform api_set_actor(p_actor);
  update stages set name = trim(p_name) where id = p_stage and workspace_id = p_ws;
  if not found then raise exception 'Stage not found.' using errcode = 'P0002'; end if;
end $$;

-- p_ids = every stage of the pipeline in the new order
create function api_reorder_stages(p_actor uuid, p_ws uuid, p_pipeline uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform api_set_actor(p_actor);
  if (select count(*) from stages where pipeline_id = p_pipeline and workspace_id = p_ws) <> cardinality(p_ids)
     or exists (select 1 from unnest(p_ids) i where i not in (select id from stages where pipeline_id = p_pipeline and workspace_id = p_ws)) then
    raise exception 'Stage list is out of date. Reload and try again.' using errcode = 'P0001';
  end if;
  update stages s set position = o.ord - 1 from unnest(p_ids) with ordinality o(id, ord) where s.id = o.id;
end $$;

create function api_delete_stage(p_actor uuid, p_ws uuid, p_stage uuid, p_move_to uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pl uuid;
begin
  perform api_set_actor(p_actor);
  select pipeline_id into pl from stages where id = p_stage and workspace_id = p_ws;
  if pl is null then raise exception 'Stage not found.' using errcode = 'P0002'; end if;
  if (select count(*) from stages where pipeline_id = pl) <= 2 then
    raise exception 'A pipeline needs at least two stages.' using errcode = 'P0001';
  end if;
  perform delete_stage(p_stage, p_move_to);   -- refuses if deals remain and no destination is given
  perform api_renumber_stages(pl);
end $$;

-- replace a stage's required fields with exactly this set
create function api_set_required(p_actor uuid, p_ws uuid, p_stage uuid, p_fields uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform api_set_actor(p_actor);
  if not exists (select 1 from stages where id = p_stage and workspace_id = p_ws) then
    raise exception 'Stage not found.' using errcode = 'P0002';
  end if;
  delete from stage_required_fields where stage_id = p_stage and field_id <> all (coalesce(p_fields, '{}'));
  insert into stage_required_fields (workspace_id, stage_id, field_id)
    select p_ws, p_stage, f from unnest(coalesce(p_fields, '{}')) f
  on conflict (stage_id, field_id) do nothing;   -- the guard trigger rejects foreign or non-opportunity fields
end $$;

create function api_add_field(p_actor uuid, p_ws uuid, p_id uuid, p_entity text, p_pipeline uuid,
                              p_name text, p_type text, p_options jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform api_set_actor(p_actor);
  if p_pipeline is not null and not exists (select 1 from pipelines where id = p_pipeline and workspace_id = p_ws) then
    raise exception 'Pipeline not found.' using errcode = 'P0002';
  end if;
  insert into field_definitions (id, workspace_id, entity, pipeline_id, name, type, options, position)
  values (p_id, p_ws, p_entity, case when p_entity = 'opportunity' then p_pipeline end, trim(p_name), p_type,
          coalesce(p_options, '[]'::jsonb), (select coalesce(max(position) + 1, 0) from field_definitions where workspace_id = p_ws));
end $$;

-- removes the field, its stage requirements (cascade) and its stored values on records
create function api_delete_field(p_actor uuid, p_ws uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform api_set_actor(p_actor);
  delete from field_definitions where id = p_id and workspace_id = p_ws;
  if not found then raise exception 'Field not found.' using errcode = 'P0002'; end if;
  update contacts set custom = custom - p_id::text where workspace_id = p_ws and custom ? p_id::text;
  update opportunities set custom = custom - p_id::text where workspace_id = p_ws and custom ? p_id::text;
end $$;

revoke all on function
  api_renumber_stages(uuid), api_add_pipeline(uuid, uuid, uuid, text, uuid[]), api_add_stage(uuid, uuid, uuid, uuid, text),
  api_rename_stage(uuid, uuid, uuid, text), api_reorder_stages(uuid, uuid, uuid, uuid[]), api_delete_stage(uuid, uuid, uuid, uuid),
  api_set_required(uuid, uuid, uuid, uuid[]), api_add_field(uuid, uuid, uuid, text, uuid, text, text, jsonb), api_delete_field(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function
  api_renumber_stages(uuid), api_add_pipeline(uuid, uuid, uuid, text, uuid[]), api_add_stage(uuid, uuid, uuid, uuid, text),
  api_rename_stage(uuid, uuid, uuid, text), api_reorder_stages(uuid, uuid, uuid, uuid[]), api_delete_stage(uuid, uuid, uuid, uuid),
  api_set_required(uuid, uuid, uuid, uuid[]), api_add_field(uuid, uuid, uuid, text, uuid, text, text, jsonb), api_delete_field(uuid, uuid, uuid)
to service_role;
