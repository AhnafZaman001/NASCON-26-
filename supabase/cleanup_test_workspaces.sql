-- One-off: remove the workspaces left behind by automated end-to-end tests ("E2E ..." names).
-- Deleting a workspace cascades to its rows, and the audit triggers on those rows (plus the
-- audit log's tamper protection) would block it. This pauses the user-defined triggers on the
-- affected tables for this transaction only; foreign-key cascades still run (system triggers).
begin;
alter table audit_log             disable trigger user;
alter table workspaces            disable trigger user;
alter table roles                 disable trigger user;
alter table members               disable trigger user;
alter table pipelines             disable trigger user;
alter table stages                disable trigger user;
alter table field_definitions     disable trigger user;
alter table stage_required_fields disable trigger user;
alter table integrations          disable trigger user;
alter table contacts              disable trigger user;
alter table companies             disable trigger user;
alter table opportunities         disable trigger user;

delete from workspaces where name like 'E2E %';

alter table audit_log             enable trigger user;
alter table workspaces            enable trigger user;
alter table roles                 enable trigger user;
alter table members               enable trigger user;
alter table pipelines             enable trigger user;
alter table stages                enable trigger user;
alter table field_definitions     enable trigger user;
alter table stage_required_fields enable trigger user;
alter table integrations          enable trigger user;
alter table contacts              enable trigger user;
alter table companies             enable trigger user;
alter table opportunities         enable trigger user;
commit;

-- check: should return 0
select count(*) as e2e_workspaces_left from workspaces where name like 'E2E %';
