-- ============================================================================
-- Dim Sum POS — Station Routing Migration
-- Each menu item gets a station (kitchen/bar). Print jobs get a station
-- so the printer service knows which printer to send them to.
--   station = 'kitchen'  → kitchen printer  (food + food restock)
--   station = 'bar'      → bar printer      (drinks + drinks restock)
--   station = 'cashier'  → counter printer  (customer receipts + refunds)
-- Run in Supabase SQL editor. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. menu_items.station — kitchen (default) or bar.
-- ----------------------------------------------------------------------------
alter table menu_items
  add column if not exists station text not null default 'kitchen';

alter table menu_items drop constraint if exists menu_items_station_check;
alter table menu_items
  add constraint menu_items_station_check
  check (station in ('kitchen', 'bar'));

-- ----------------------------------------------------------------------------
-- 2. print_jobs.station — required for routing.
-- ----------------------------------------------------------------------------
alter table print_jobs
  add column if not exists station text not null default 'kitchen';

alter table print_jobs drop constraint if exists print_jobs_station_check;
alter table print_jobs
  add constraint print_jobs_station_check
  check (station in ('kitchen', 'bar', 'cashier'));

-- Backfill: receipts + refunds go to cashier, everything else stays kitchen.
update print_jobs set station = 'cashier'
  where kind in ('receipt', 'refund') and station = 'kitchen';

-- Speed up "pending job for station X" queries.
create index if not exists print_jobs_station_pending_idx
  on print_jobs (station, created_at) where printed_at is null;

-- ----------------------------------------------------------------------------
-- 3. (Optional) suggested backfill for existing drink categories.
--    Uncomment if your menu has "Drinks" as a category already.
-- ----------------------------------------------------------------------------
-- update menu_items set station = 'bar' where category = 'Drinks';
