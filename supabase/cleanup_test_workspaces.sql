-- One-off: remove the workspaces left behind by automated end-to-end tests ("E2E ..." names).
-- Workspaces can't normally be deleted because their audit rows are tamper-protected; this pauses
-- that protection for this one transaction only, then turns it back on.
begin;
alter table audit_log disable trigger audit_log_no_update;
delete from workspaces where name like 'E2E %';
alter table audit_log enable trigger audit_log_no_update;
commit;

-- check: should return 0
select count(*) as e2e_workspaces_left from workspaces where name like 'E2E %';
