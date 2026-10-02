-- Collapse the whole menu into THREE categories, one per printer.
--
--   Noodles & Fried  -> kitchen printer
--   Counter Food     -> cashier / front-counter printer  (dim sum, buns,
--                        rice, roasted, other — everything sold at the front)
--   Drinks           -> bar printer
--
-- Run this once in the Supabase SQL editor (it runs as the service role, so
-- row-level security won't block it).  Routing in the app is driven by the
-- category; the `station` column is kept in sync for on-screen display only.

-- 1) Reclassify every item's category into one of the three.
update menu_items
set category = case
  when lower(trim(category)) = 'drinks' then 'Drinks'
  when lower(trim(category)) in ('noodles', 'fried', 'noodles / fried', 'noodles & fried')
       then 'Noodles'
  else 'Counter'
end;

-- 2) Sync the station field to match the new category.
update menu_items
set station = case
  when category = 'Drinks'  then 'bar'
  when category = 'Noodles' then 'kitchen'
  else 'cashier'
end;

-- 3) Verify the result.
select category, station, count(*)
from menu_items
group by category, station
order by category;
