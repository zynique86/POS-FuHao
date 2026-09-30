-- ============================================================================
--  FUHAO POS  —  FIX / CREATE  expenses + audit_log
--
--  Creates both tables if they don't exist, adds any missing columns,
--  sets up Row Level Security, and grants access to signed-in users.
--  Safe to run on a fresh project OR one where these tables already exist.
--
--  Run in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================================


-- ============================================================================
--  1.  EXPENSES TABLE
-- ============================================================================

create table if not exists expenses (
  id              bigserial primary key,
  kind            text not null,
  business_date   date not null,
  amount          numeric(10,2) not null,
  payment_method  text,
  description     text,
  supplier        text,
  receipt_url     text,
  staff_name      text,
  hours           numeric(6,2),
  normal_wage     numeric(10,2),
  ot_amount       numeric(10,2),
  other_amount    numeric(10,2),
  note            text,
  created_by      text,
  created_at      timestamptz not null default now()
);

-- Add any columns that might be missing (idempotent)
alter table expenses add column if not exists kind           text;
alter table expenses add column if not exists business_date  date;
alter table expenses add column if not exists amount         numeric(10,2);
alter table expenses add column if not exists payment_method text;
alter table expenses add column if not exists description    text;
alter table expenses add column if not exists supplier       text;
alter table expenses add column if not exists receipt_url    text;
alter table expenses add column if not exists staff_name     text;
alter table expenses add column if not exists hours          numeric(6,2);
alter table expenses add column if not exists normal_wage    numeric(10,2);
alter table expenses add column if not exists ot_amount      numeric(10,2);
alter table expenses add column if not exists other_amount   numeric(10,2);
alter table expenses add column if not exists note           text;
alter table expenses add column if not exists created_by     text;
alter table expenses add column if not exists created_at     timestamptz not null default now();

-- Remove the constraint if wrong, re-add correct one
alter table expenses drop constraint if exists expenses_kind_check;
alter table expenses add constraint expenses_kind_check
  check (kind in ('wages', 'meal', 'purchase', 'other', 'rent', 'utility'));

-- Helpful indexes
create index if not exists expenses_date_idx on expenses (business_date, kind);
create index if not exists expenses_kind_idx on expenses (kind, business_date);


-- ============================================================================
--  2.  AUDIT LOG TABLE
-- ============================================================================

create table if not exists audit_log (
  id           bigserial primary key,
  actor_email  text,
  actor_role   text,
  action       text not null,
  target_type  text,
  target_id    bigint,
  amount       numeric(10,2),
  reason       text,
  details      jsonb,
  created_at   timestamptz not null default now()
);

alter table audit_log add column if not exists actor_email text;
alter table audit_log add column if not exists actor_role  text;
alter table audit_log add column if not exists action      text;
alter table audit_log add column if not exists target_type text;
alter table audit_log add column if not exists target_id   bigint;
alter table audit_log add column if not exists amount      numeric(10,2);
alter table audit_log add column if not exists reason      text;
alter table audit_log add column if not exists details     jsonb;
alter table audit_log add column if not exists created_at  timestamptz not null default now();

create index if not exists audit_log_date_idx   on audit_log (created_at desc);
create index if not exists audit_log_action_idx on audit_log (action, created_at desc);


-- ============================================================================
--  3.  ROW LEVEL SECURITY — the most likely reason nothing loads
-- ============================================================================

alter table expenses  enable row level security;
alter table audit_log enable row level security;

-- Drop any old policies to avoid conflicts
drop policy if exists expenses_all_auth   on expenses;
drop policy if exists expenses_select     on expenses;
drop policy if exists expenses_insert     on expenses;
drop policy if exists expenses_update     on expenses;
drop policy if exists expenses_delete     on expenses;
drop policy if exists audit_read_auth     on audit_log;
drop policy if exists audit_insert_auth   on audit_log;
drop policy if exists audit_select        on audit_log;

-- New clean policies: signed-in users can do everything
create policy expenses_all_auth on expenses
  for all to authenticated using (true) with check (true);

create policy audit_select on audit_log
  for select to authenticated using (true);

create policy audit_insert on audit_log
  for insert to authenticated with check (true);


-- ============================================================================
--  4.  REALTIME PUBLICATION — so the expenses page auto-refreshes
-- ============================================================================

do $$
begin
  begin
    alter publication supabase_realtime add table expenses;
  exception when duplicate_object then null;
           when others then null;
  end;
end $$;


-- ============================================================================
--  5.  RELOAD POSTGREST SCHEMA CACHE
--     Forces the API to pick up the tables/columns immediately.
-- ============================================================================

notify pgrst, 'reload schema';


-- ============================================================================
--  DONE.  After running:
--    1. Hard-refresh your POS tab (Cmd/Ctrl + Shift + R)
--    2. Try Admin → Daily Expenses again
--    3. Try Admin → Audit Log again
-- ============================================================================
