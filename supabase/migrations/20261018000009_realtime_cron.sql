-- 0009 Realtime + escalation scheduler
-- Needs: 0003. Enable the pg_cron extension in the Dashboard first.

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
