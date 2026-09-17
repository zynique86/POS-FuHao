-- ============================================================================
--  FUHAO DIM SUM POS  —  CLEANUP UNUSED TABLES + COLUMNS
--
--  Removes everything that's no longer used now that the app has been
--  simplified to Supabase-Auth-only (no roles, no staff management):
--
--    ✗ staff             (no more staff management UI)
--    ✗ staff_actions     (legacy — replaced by audit_log)
--    ✗ expenses.staff_id / expenses.staff_name is now the only wage identifier
--    ✗ z_reports.closed_by_staff_id
--
--  Existing expense rows, orders, audit_log, etc. are all preserved.
--
--  Run in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================================


-- 1. Drop the staff_actions table (legacy audit — replaced by audit_log).
drop table if exists staff_actions cascade;

-- 2. Drop the staff table.  `cascade` removes the foreign-key constraints
--    on expenses.staff_id and z_reports.closed_by_staff_id automatically.
--    The columns themselves are dropped separately below.
drop table if exists staff cascade;

-- 3. Remove the now-orphaned staff_id column from expenses.
--    `staff_name` (already a text snapshot) is enough for wages entry.
alter table expenses  drop column if exists staff_id;

-- 4. Remove the now-orphaned staff_id column from z_reports.
alter table z_reports drop column if exists closed_by_staff_id;

-- 5. Reload PostgREST's schema cache so the API stops advertising the
--    dropped tables and columns immediately.
notify pgrst, 'reload schema';


-- ============================================================================
--  DONE.
--
--  Now:
--    • Add users through Supabase → Authentication → Users
--    • Anyone signed in has full access
--    • Wages entry uses a plain text name field (no dropdown)
-- ============================================================================
