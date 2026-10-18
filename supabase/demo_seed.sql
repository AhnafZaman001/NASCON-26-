-- Demo data. Run AFTER signing up through the app (needs an existing workspace + owner).
-- Safe to re-run: it skips if demo contacts already exist.
do $$
declare ws uuid; solar uuid; sales uuid; f_roof uuid; f_kw uuid; f_budget uuid; f_lang uuid; c uuid; i int;
begin
  select workspace_id into ws from members where level = 'owner' order by created_at limit 1;
  if ws is null then raise exception 'Sign up first: no workspace found.'; end if;
  if exists (select 1 from contacts where workspace_id = ws and source = 'demo_seed') then
    raise notice 'Demo data already present.'; return;
  end if;

  -- short timers so escalation is visible live (15s per level)
  update workspaces set settings = settings || jsonb_build_object(
    'ack_window_seconds', 15,
    'escalation_chain', '[{"step":"next","window_seconds":15},{"step":"backup","window_seconds":15},{"step":"manager","window_seconds":15}]'::jsonb)
  where id = ws;

  select id into sales from pipelines where workspace_id = ws order by position limit 1;
  insert into pipelines (workspace_id, name, position) values (ws, 'Solar Installations', 1) returning id into solar;
  insert into stages (workspace_id, pipeline_id, name, position, kind) values
    (ws, solar, 'Enquiry', 0, 'open'), (ws, solar, 'Site survey', 1, 'open'),
    (ws, solar, 'Quote sent', 2, 'open'), (ws, solar, 'Installed', 3, 'won'), (ws, solar, 'Lost', 4, 'lost');

  -- different custom fields per pipeline (F2.3)
  insert into field_definitions (workspace_id, entity, pipeline_id, name, type, options)
    values (ws, 'opportunity', sales, 'Budget', 'number', '[]') returning id into f_budget;
  insert into field_definitions (workspace_id, entity, pipeline_id, name, type, options)
    values (ws, 'opportunity', solar, 'Roof type', 'dropdown', '["Flat","Tiled","Metal"]') returning id into f_roof;
  insert into field_definitions (workspace_id, entity, pipeline_id, name, type)
    values (ws, 'opportunity', solar, 'System size (kW)', 'number') returning id into f_kw;
  insert into field_definitions (workspace_id, entity, name, type, options)
    values (ws, 'contact', 'Preferred language', 'dropdown', '["English","Urdu"]') returning id into f_lang;

  -- stage-specific required fields (F2.4)
  insert into stage_required_fields (workspace_id, stage_id, field_id)
    select s.workspace_id, s.id, f from stages s, unnest(array[f_roof, f_kw]) f where s.pipeline_id = solar and s.name = 'Quote sent';
  insert into stage_required_fields (workspace_id, stage_id, field_id)
    select s.workspace_id, s.id, f_budget from stages s where s.pipeline_id = sales and s.name = 'Proposal';

  for i in 1..8 loop
    insert into contacts (workspace_id, full_name, email, phone, tags, source, custom)
    values (ws, (array['Ayesha Khan','Bilal Ahmed','Sana Malik','Hamza Raza','Mariam Noor','Usman Ali','Zara Sheikh','Faisal Iqbal'])[i],
            'demo' || i || '@example.com', '+92300000010' || i,
            case when i % 2 = 0 then array['vip'] else array['new'] end, 'demo_seed',
            jsonb_build_object(f_lang::text, case when i % 2 = 0 then 'Urdu' else 'English' end))
    returning id into c;
    insert into opportunities (workspace_id, contact_id, pipeline_id, stage_id, title, value, custom)
    values (ws, c, case when i <= 4 then solar else sales end,
            (select id from stages where pipeline_id = case when i <= 4 then solar else sales end and position = 0),
            case when i <= 4 then 'Rooftop solar - ' else 'Service plan - ' end || i,
            (5000 + i * 1500), '{}'::jsonb);
  end loop;
end $$;
