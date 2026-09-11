-- ============================================================================
-- Dim Sum POS — Item Options + Notes + Discount Migration
--
-- Adds:
--   • order_items.options   — chosen modifier chips (e.g. "no pork, extra sauce")
--   • order_items.note      — free-form kitchen note for this line
--   • orders.discount        — RM amount discounted from the grand total
--   • orders.discount_reason — optional reason (e.g. "regular customer")
--
-- Safe to re-run.
-- ============================================================================

alter table order_items add column if not exists options text;
alter table order_items add column if not exists note    text;

alter table orders add column if not exists discount        numeric(10,2) not null default 0;
alter table orders add column if not exists discount_reason text;
