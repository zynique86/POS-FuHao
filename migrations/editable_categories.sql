-- ============================================================================
--  FUHAO POS — let admins create / edit menu categories and pick the printer
--
--  Before: the category list and "which printer does it print at" were
--  hard-coded in lib/types.ts (with a copy in category_station_routing that
--  send_order() reads).  Changing anything needed a code change.
--
--  After: category_station_routing is THE category list.  Admins manage it
--  from Admin > Menu > "Categories & printers".  send_order() already reads
--  this table, so new orders follow the new setting immediately.
--
--  Columns added (existing rows are back-filled, nothing is renamed):
--     name      text  — exact text stored in menu_items.category ("Dim Sum")
--     name_zh   text  — optional Chinese label shown on the POS chips
--     emoji     text  — chip icon
--     position  int   — order of the chips on the POS (low first)
--  The primary key `category` stays the lower-cased name, which is what
--  send_order() matches against.
--
--  Writes are admin-only via public.is_admin(), same as menu_items.
--  Idempotent: safe to run more than once.
-- ============================================================================

alter table public.category_station_routing
  add column if not exists name     text,
  add column if not exists name_zh  text,
  add column if not exists emoji    text,
  add column if not exists position integer not null default 0;

-- Back-fill display data for the categories that already exist.
update public.category_station_routing c set
  name     = coalesce(c.name, v.name),
  name_zh  = coalesce(c.name_zh, v.name_zh),
  emoji    = coalesce(c.emoji, v.emoji),
  position = case when c.position = 0 then v.position else c.position end
from (values
  ('dim sum', 'Dim Sum', '點心', '🥟', 10),
  ('buns',    'Buns',    '包點', '🫓', 20),
  ('noodles', 'Noodles', '麵類', '🍜', 30),
  ('fried',   'Fried',   '油炸', '🍤', 40),
  ('rice',    'Rice',    '飯 / 粥', '🍚', 50),
  ('roasted', 'Roasted', '燒味', '🍖', 60),
  ('drinks',  'Drinks',  '飲料', '🫖', 70),
  ('other',   'Other',   '其他', '🍽️', 80)
) as v(category, name, name_zh, emoji, position)
where c.category = v.category;

-- 'noodles / fried' was an old alias kept only for routing; no menu item
-- uses it.  Give it a name so it is visible (and deletable) in the admin.
update public.category_station_routing
  set name = initcap(category), position = 999
  where name is null;

-- Any category that menu items use but which has no routing row yet gets
-- one (front kitchen = the old default), so it shows in the admin list.
insert into public.category_station_routing (category, station, name, position)
select distinct lower(trim(mi.category)), 'cashier', trim(mi.category), 900
from public.menu_items mi
where coalesce(trim(mi.category), '') <> ''
on conflict (category) do nothing;

alter table public.category_station_routing
  alter column name set not null;

-- ---------------------------------------------------------------------------
-- Admin-only writes (reads stay open to signed-in staff and the printer).
-- ---------------------------------------------------------------------------
drop policy if exists category_station_routing_admin_write on public.category_station_routing;
create policy category_station_routing_admin_write
  on public.category_station_routing
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant insert, update, delete on public.category_station_routing to authenticated;

-- ---------------------------------------------------------------------------
-- save_menu_category(): add or edit (incl. rename) one category.
--   p_old_key  — existing key (lower-case name) when editing; null to add.
-- Renaming also moves every menu item in the category, and the menu items'
-- legacy `station` column is kept in step with the chosen printer.
-- SECURITY INVOKER: RLS on both tables still applies (admin only).
-- ---------------------------------------------------------------------------
create or replace function public.save_menu_category(
  p_old_key  text,
  p_name     text,
  p_name_zh  text,
  p_emoji    text,
  p_station  text,
  p_position integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_name    text := trim(coalesce(p_name, ''));
  v_new_key text := lower(trim(coalesce(p_name, '')));
  v_old_key text := lower(trim(coalesce(p_old_key, '')));
  v_old_name text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change categories';
  end if;
  if v_name = '' then
    raise exception 'Category name is required';
  end if;
  if p_station not in ('kitchen', 'cashier', 'bar') then
    raise exception 'Unknown printer: %', p_station;
  end if;

  if v_old_key = '' then
    -- Add
    if exists (select 1 from category_station_routing where category = v_new_key) then
      raise exception 'A category called "%" already exists', v_name;
    end if;
    insert into category_station_routing (category, station, name, name_zh, emoji, position)
    values (v_new_key, p_station, v_name, nullif(trim(p_name_zh), ''),
            nullif(trim(p_emoji), ''), coalesce(p_position, 0));
  else
    select name into v_old_name from category_station_routing where category = v_old_key;
    if v_old_name is null then
      raise exception 'Category not found';
    end if;
    if v_new_key <> v_old_key
       and exists (select 1 from category_station_routing where category = v_new_key) then
      raise exception 'A category called "%" already exists', v_name;
    end if;

    update category_station_routing set
      category = v_new_key,
      station  = p_station,
      name     = v_name,
      name_zh  = nullif(trim(p_name_zh), ''),
      emoji    = nullif(trim(p_emoji), ''),
      position = coalesce(p_position, position)
    where category = v_old_key;

    -- Move the items across on rename (case/spacing-insensitive match).
    update menu_items set category = v_name
    where lower(trim(category)) = v_old_key
      and category is distinct from v_name;
  end if;

  -- Keep menu_items.station in step with the category's printer.
  update menu_items set station = p_station
  where lower(trim(category)) = v_new_key
    and station is distinct from p_station;

  return jsonb_build_object('key', v_new_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_menu_category(): only allowed when no menu item uses it.
-- ---------------------------------------------------------------------------
create or replace function public.delete_menu_category(p_key text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_key text := lower(trim(coalesce(p_key, '')));
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change categories';
  end if;
  select count(*) into v_count from menu_items where lower(trim(category)) = v_key;
  if v_count > 0 then
    raise exception 'This category still has % menu item(s). Move them to another category first.', v_count;
  end if;
  delete from category_station_routing where category = v_key;
end;
$$;

revoke execute on function public.save_menu_category(text, text, text, text, text, integer) from public, anon;
revoke execute on function public.delete_menu_category(text) from public, anon;
grant execute on function public.save_menu_category(text, text, text, text, text, integer) to authenticated;
grant execute on function public.delete_menu_category(text) to authenticated;

-- Let the POS / kitchen screens pick up changes live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'category_station_routing'
  ) then
    alter publication supabase_realtime add table public.category_station_routing;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
--  DONE.
-- ============================================================================
