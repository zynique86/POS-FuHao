-- ============================================================================
-- Dim Sum POS — Remove modal / cost tracking + Ingredients
-- Drops cost_price, cost_at_time, and the ingredients table.
-- Safe to re-run.
-- ============================================================================

alter table if exists menu_items  drop column if exists cost_price;
alter table if exists order_items drop column if exists cost_at_time;

drop table if exists ingredients cascade;
