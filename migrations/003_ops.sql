-- ============================================================================
-- Dim Sum POS — Operations Migration
-- Adds: shift_opens (opening float + closing count), refund status support.
-- Run in Supabase SQL editor. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shift_opens — one row per business day per cashier open.
--    Cashier opens the shift with the opening cash float; at end of day
--    the manager records the counted drawer amount.
-- ----------------------------------------------------------------------------
create table if not exists shift_opens (
  id             bigserial primary key,
  business_date  date not null,
  opened_at      timestamptz not null default now(),
  opened_by      text,                    -- staff name / email
  opening_float  numeric(10,2) not null default 0,
  closed_at      timestamptz,
  closed_by      text,
  closing_count  numeric(10,2),           -- what was actually counted in the drawer
  expected_close numeric(10,2),           -- opening_float + cash_sales - refunds
  variance       numeric(10,2),           -- closing_count - expected_close
  notes          text
);
create unique index if not exists shift_opens_date_idx
  on shift_opens (business_date) where closed_at is null;

alter table shift_opens enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'shift_opens' and policyname = 'shifts_read_auth') then
    create policy shifts_read_auth on shift_opens for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shift_opens' and policyname = 'shifts_write_auth') then
    create policy shifts_write_auth on shift_opens for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Allow "refunded" order status. A refund creates a new payment row
--    with negative amount and flips orders.status to 'refunded'.
-- ----------------------------------------------------------------------------
-- No schema change required — orders.status is text; the app enforces it.
-- Just ensure payments allows negative amount (numeric already does).

-- ----------------------------------------------------------------------------
-- 3. print_jobs: allow 'refund' kind for reprinting the refund slip.
-- ----------------------------------------------------------------------------
alter table print_jobs drop constraint if exists print_jobs_kind_check;
alter table print_jobs
  add constraint print_jobs_kind_check
  check (kind in ('kitchen', 'receipt', 'void', 'refund'));
