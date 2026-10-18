-- Post-migration sanity checks. Run in the SQL Editor after applying all migrations.
-- Each query says what a healthy result looks like.

-- 1. Expect 21 (all core tables)
select count(*) as tables from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE';

-- 2. Expect 3 views: leads_v, opportunities_v, recovery_queue_v
select table_name from information_schema.views where table_schema = 'public' order by 1;

-- 3. RLS must be ON for every table (expect 0 rows)
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- 4. Escalation timer (expect one row: nascon-escalate, 10 seconds)
select jobname, schedule from cron.job;

-- 5. Audit log is append-only (expect an ERROR: audit_log is append-only)
-- delete from audit_log;

-- 6. Core functions exist (expect 9)
select count(*) as functions from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('assign_lead','acknowledge_lead','escalate_expired_leads',
   'set_member_status','reassign_lead','pick_assignee','dashboard_metrics','bootstrap_workspace','delete_stage');
