-- ============================================================================
-- Dim Sum POS — Features Migration
-- Adds: voids, unified print_jobs queue, staff+PIN, z_reports.
-- Run in Supabase SQL editor.  Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Void on order_items
--    A voided item is kept in the database (for the audit trail) but
--    excluded from totals and hidden from the kitchen queue.
-- ----------------------------------------------------------------------------
alter table order_items
  add column if not exists voided_at        timestamptz,
  add column if not exists void_reason      text,
  add column if not exists voided_by        text;

-- ----------------------------------------------------------------------------
-- 2. print_jobs — unified print queue
--    Any surface (POS, cashier, admin) inserts a row; the printer service
--    subscribes to INSERTs and dispatches by `kind`.
-- ----------------------------------------------------------------------------
create table if not exists print_jobs (
  id          bigserial primary key,
  order_id    bigint,
  kind        text not null check (kind in ('kitchen', 'receipt', 'void')),
  payload     jsonb,                       -- kitchen: {item_ids: [..]}, void: {item_id, reason}
  created_at  timestamptz not null default now(),
  printed_at  timestamptz
);
create index if not exists print_jobs_pending_idx
  on print_jobs (created_at) where printed_at is null;

-- ----------------------------------------------------------------------------
-- 3. staff — tied to auth.users
--    PIN is used to gate privileged actions (void/refund/admin).
--    Add rows manually in the SQL editor after creating the auth users.
-- ----------------------------------------------------------------------------
create table if not exists staff (
  id         bigserial primary key,
  user_id    uuid unique references auth.users(id) on delete cascade,
  name       text not null,
  pin        text not null,                 -- 4–6 digit
  role       text not null default 'cashier'
             check (role in ('cashier', 'manager', 'admin')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists staff_actions (
  id         bigserial primary key,
  staff_id   bigint references staff(id) on delete set null,
  action     text not null,                 -- 'void', 'reprint', 'day_close', 'settings_update'
  order_id   bigint,
  details    jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. z_reports — one row per closed business day
-- ----------------------------------------------------------------------------
create table if not exists z_reports (
  id                  bigserial primary key,
  business_date       date not null unique,
  closed_at           timestamptz not null default now(),
  closed_by_staff_id  bigint references staff(id) on delete set null,
  revenue             numeric(12,2) not null,
  order_count         int not null,
  void_count          int not null,
  payment_methods     jsonb,                -- {"cash": 456.7, "duitnow_qr": 123, "card": 78}
  best_sellers        jsonb,                -- [{name, qty, revenue}, ...]
  raw                 jsonb
);

-- ----------------------------------------------------------------------------
-- 5. RLS + Realtime
-- ----------------------------------------------------------------------------
alter table print_jobs    enable row level security;
alter table staff         enable row level security;
alter table staff_actions enable row level security;
alter table z_reports     enable row level security;

do $$
begin
  -- print_jobs: anon needs to read (printer-service uses anon key);
  -- authenticated users insert new jobs from POS/cashier
  if not exists (select 1 from pg_policies where tablename = 'print_jobs' and policyname = 'pj_read_any') then
    create policy pj_read_any    on print_jobs for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'print_jobs' and policyname = 'pj_insert_auth') then
    create policy pj_insert_auth on print_jobs for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'print_jobs' and policyname = 'pj_update_any') then
    -- printer service (anon) marks jobs printed
    create policy pj_update_any on print_jobs for update to anon, authenticated using (true) with check (true);
  end if;

  -- staff: authed users can read their own row + list of names; only admin should insert (do it via SQL editor for now)
  if not exists (select 1 from pg_policies where tablename = 'staff' and policyname = 'staff_read_auth') then
    create policy staff_read_auth on staff for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'staff_actions' and policyname = 'sa_read_auth') then
    create policy sa_read_auth   on staff_actions for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'staff_actions' and policyname = 'sa_insert_auth') then
    create policy sa_insert_auth on staff_actions for insert to authenticated with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'z_reports' and policyname = 'zr_read_auth') then
    create policy zr_read_auth   on z_reports for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'z_reports' and policyname = 'zr_insert_auth') then
    create policy zr_insert_auth on z_reports for insert to authenticated with check (true);
  end if;

  -- order_items updates: authenticated staff (needed for voids + kitchen status)
  if not exists (select 1 from pg_policies where tablename = 'order_items' and policyname = 'oi_update_auth') then
    create policy oi_update_auth on order_items for update to authenticated using (true) with check (true);
  end if;
end $$;

-- Realtime — printer-service subscribes to print_jobs INSERT.
do $$
begin
  begin
    alter publication supabase_realtime add table print_jobs;
  exception when duplicate_object then null;
  end;
end $$;
