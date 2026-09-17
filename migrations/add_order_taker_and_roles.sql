-- ============================================================================
--  FUHAO POS  —  ADD ORDER-TAKER + TWO-ROLE SYSTEM
--
--  1. Adds `taken_by_email` and `taken_by_name` to the orders table so every
--     order records which staff member sent it — visible on Kitchen, Bar,
--     Cashier and admin screens.
--
--  2. Roles are stored inside Supabase Auth itself (in each user's
--     `raw_user_meta_data` JSON), so no separate table is needed.
--     Two roles: 'staff' and 'admin'.
--     Default (no metadata set)  =  staff
--
--  How to set a user's role:
--    Supabase → Authentication → Users → click a user
--    → scroll to "Raw User Meta Data" → edit as JSON:
--
--        {"role": "admin", "name": "Ah Kong"}       ← admin
--        {"role": "staff", "name": "Mei Ling"}      ← staff
--
--    Save.  The next time they sign in, the app picks up the new role.
--
--  Run in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================================

alter table orders add column if not exists taken_by_email text;
alter table orders add column if not exists taken_by_name  text;

create index if not exists orders_taken_by_email_idx on orders (taken_by_email);
create index if not exists orders_taken_by_open_idx  on orders (taken_by_email) where paid_at is null;

notify pgrst, 'reload schema';


-- ============================================================================
--  DONE.  No new tables — Supabase Auth carries the role.
-- ============================================================================
