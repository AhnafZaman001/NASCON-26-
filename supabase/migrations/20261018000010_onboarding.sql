-- 0010 Onboarding
-- Needs: 0001-0009. bootstrap_workspace() is called by the server right after signup.

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


grant execute on function bootstrap_workspace(uuid, text, text, text) to service_role;
