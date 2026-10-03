-- ============================================================================
--  FUHAO POS  —  REMOVE the audit_log system
--
--  Drops the audit_log table entirely.  Everything about the audit log
--  is being removed from the app (the /admin/audit-log page, the
--  logAudit() helper, the AuditAction / AuditLog types) so the table
--  is no longer needed.
--
--  Safe to run — the drop is `if exists` and the audit log was read-only
--  from the app side, so nothing downstream depends on it.
--
--  Run in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================================

drop table if exists audit_log cascade;

notify pgrst, 'reload schema';

-- ============================================================================
--  DONE.
-- ============================================================================
