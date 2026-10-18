-- 0007 Views & dashboard
-- Needs: 0001-0006. Creates: opportunities_v (masked value), recovery_queue_v, leads_v, dashboard_metrics().

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

