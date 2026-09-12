-- ============================================================================
-- Dim Sum POS — Per-Item Modifiers Migration
-- Adds options_available (JSON array of {label, label_zh}) on menu_items,
-- so every dish can have its own custom modifier chips instead of a global
-- shared list.
-- Safe to re-run.
-- ============================================================================

alter table menu_items
  add column if not exists options_available jsonb not null default '[]'::jsonb;
