-- ============================================================================
--  FUHAO POS — remove the unused sort_order column from menu_items
--
--  The manual "sort order" field was removed from the app.  Menu items now
--  display grouped by category in insertion order (by id), so this column is
--  no longer used anywhere.
--
--  Run AFTER deploying the updated app (which no longer references sort_order).
--  Safe to run even if the column is already gone.
-- ============================================================================

alter table menu_items drop column if exists sort_order;

notify pgrst, 'reload schema';

-- ============================================================================
--  DONE.
-- ============================================================================
