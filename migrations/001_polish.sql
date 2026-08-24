-- ============================================================================
-- Dim Sum POS — Polish Migration
-- Run this in Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT throughout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. menu_items: add category, availability, sort order
-- ----------------------------------------------------------------------------
alter table menu_items
  add column if not exists category    text    not null default 'Other',
  add column if not exists is_available boolean not null default true,
  add column if not exists sort_order  int     not null default 0;

create index if not exists menu_items_category_idx
  on menu_items (category, sort_order, id);

-- ----------------------------------------------------------------------------
-- 2. order_items: snapshot the Chinese name too, so receipts stay bilingual
--    even if the menu name is later edited.
-- ----------------------------------------------------------------------------
alter table order_items
  add column if not exists name_zh_snapshot text;

-- ----------------------------------------------------------------------------
-- 3. orders: money breakdown (subtotal / service charge / SST / rounding).
--    `total` remains the final grand total the customer pays.
-- ----------------------------------------------------------------------------
alter table orders
  add column if not exists subtotal        numeric(10,2),
  add column if not exists service_charge  numeric(10,2) not null default 0,
  add column if not exists tax             numeric(10,2) not null default 0,
  add column if not exists rounding        numeric(10,2) not null default 0;

-- Backfill: for historical rows, treat total as subtotal (no tax breakdown known).
update orders set subtotal = total where subtotal is null;

-- ----------------------------------------------------------------------------
-- 4. shop_settings: single-row config the admin can edit from the UI.
-- ----------------------------------------------------------------------------
create table if not exists shop_settings (
  id                 int         primary key default 1,
  shop_name          text        not null default 'DIM SUM SHOP',
  shop_name_zh       text        not null default '',
  address            text        not null default '',
  sst_pct            numeric(5,2) not null default 0,   -- e.g. 6.00
  service_charge_pct numeric(5,2) not null default 0,   -- e.g. 10.00
  round_to_5_sen     boolean     not null default true, -- Malaysia dropped 1¢/2¢ coins
  updated_at         timestamptz not null default now(),
  constraint shop_settings_singleton check (id = 1)
);

insert into shop_settings (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 5. RLS: assume you already have policies for orders / menu_items / payments.
--    These add matching policies for the new shop_settings table and for
--    menu_items writes (needed by the admin CRUD page).
--    Adjust to your actual policy scheme if it differs.
-- ----------------------------------------------------------------------------
alter table shop_settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'shop_settings' and policyname = 'settings_read_auth') then
    create policy settings_read_auth on shop_settings
      for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'shop_settings' and policyname = 'settings_read_anon') then
    -- printer-service uses the anon key; needs to read shop_name for the receipt header
    create policy settings_read_anon on shop_settings
      for select to anon using (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'shop_settings' and policyname = 'settings_update_auth') then
    create policy settings_update_auth on shop_settings
      for update to authenticated using (true) with check (true);
  end if;

  -- Menu CRUD by authenticated staff:
  if not exists (select 1 from pg_policies where tablename = 'menu_items' and policyname = 'menu_write_auth') then
    create policy menu_write_auth on menu_items
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 6. Realtime: publish shop_settings + menu_items so the POS and printer
--    react instantly to price/availability/tax changes without a reload.
--    (Ignore duplicate-object errors if these tables are already in the
--    publication.)
-- ----------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table shop_settings;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table menu_items;
  exception when duplicate_object then null;
  end;
end $$;

-- ----------------------------------------------------------------------------
-- 7. (Optional but handy) seed a starter dim sum menu with categories.
--    Comment this block out if you already have menu items.
-- ----------------------------------------------------------------------------
-- insert into menu_items (name_en, name_zh, price, category, sort_order) values
--   ('Har Gow',               '虾饺',   7.80, 'Steamed', 10),
--   ('Siu Mai',               '烧卖',   6.80, 'Steamed', 20),
--   ('Char Siu Bao',          '叉烧包', 6.50, 'Steamed', 30),
--   ('Lo Mai Gai',            '糯米鸡', 8.80, 'Steamed', 40),
--   ('Chicken Feet',          '凤爪',   6.80, 'Steamed', 50),
--   ('Spring Roll',           '春卷',   6.00, 'Fried',   10),
--   ('Wu Kok (Yam Puff)',     '芋角',   6.80, 'Fried',   20),
--   ('Radish Cake',           '萝卜糕', 6.80, 'Fried',   30),
--   ('Cheong Fun (Prawn)',    '虾肠粉', 8.80, 'Rice Noodle', 10),
--   ('Cheong Fun (Char Siu)', '叉烧肠粉', 8.80, 'Rice Noodle', 20),
--   ('Century Egg Congee',    '皮蛋粥', 8.00, 'Congee',  10),
--   ('Chinese Tea',           '中国茶', 2.00, 'Drinks',  10),
--   ('Egg Tart',              '蛋挞',   4.50, 'Dessert', 10),
--   ('Mango Pudding',         '芒果布丁', 5.80, 'Dessert', 20)
-- on conflict do nothing;
