-- ============================================================================
-- Dim Sum POS — Cost Price (Modal) Migration
-- Adds cost_price on menu_items so the shop can track profit.
-- Snapshots cost_at_time on each order_items row (same pattern as
-- price_at_time) so historical margins stay accurate when costs change.
-- Run in Supabase SQL editor. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Cost price on menu_items — the "modal" (本錢) for each item.
-- ----------------------------------------------------------------------------
alter table menu_items
  add column if not exists cost_price numeric(10,2) not null default 0;

-- ----------------------------------------------------------------------------
-- 2. Snapshot cost on order_items so history doesn't shift when the
--    menu's cost_price is later edited.
-- ----------------------------------------------------------------------------
alter table order_items
  add column if not exists cost_at_time numeric(10,2) not null default 0;
