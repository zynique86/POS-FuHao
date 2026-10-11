-- ============================================================================
--  FUHAO POS — allow the three printer stations on menu_items
--
--  The menu_items.station column had an old CHECK constraint that only allowed
--  the original stations ('kitchen', 'bar'). The POS now has THREE stations:
--      kitchen = back kitchen · cashier = front kitchen · bar = bar
--  so saving a front-counter item (station 'cashier') failed with:
--      new row for relation "menu_items" violates check constraint
--      "menu_items_station_check"
--
--  This widens the constraint to accept all three.  Routing itself is driven by
--  the item's category (see stationForCategory in lib/types.ts); the `station`
--  column is kept in sync for display.
--
--  Run once in Supabase → SQL Editor.  Idempotent.
-- ============================================================================

alter table menu_items drop constraint if exists menu_items_station_check;

alter table menu_items add constraint menu_items_station_check
  check (station in ('kitchen', 'cashier', 'bar'));

notify pgrst, 'reload schema';

-- ============================================================================
--  DONE.  After running this you can add/edit items whose category routes to
--  the Front Kitchen (dim sum, buns, roasted, other) without the error.
-- ============================================================================
