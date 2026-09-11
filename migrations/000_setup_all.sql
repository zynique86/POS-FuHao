-- ============================================================================
-- Dim Sum POS — Complete Database Setup
--
-- Creates every table, column, constraint, index, RLS policy and realtime
-- publication the app expects. Also seeds sensible defaults.
--
-- Run in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run: everything uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- ============================================================================


-- ============================================================================
-- PART 1: BASE TABLES
-- ============================================================================

-- Menu items ─ dim sum, drinks, everything the POS can sell.
create table if not exists menu_items (
  id           bigserial primary key,
  name_en      text not null,
  name_zh      text,
  price        numeric(10,2) not null default 0,
  cost_price   numeric(10,2) not null default 0,
  category     text not null default 'Other',
  station      text not null default 'kitchen',
  is_available boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
alter table menu_items add column if not exists name_zh       text;
alter table menu_items add column if not exists cost_price    numeric(10,2) not null default 0;
alter table menu_items add column if not exists category      text not null default 'Other';
alter table menu_items add column if not exists station       text not null default 'kitchen';
alter table menu_items add column if not exists is_available  boolean not null default true;
alter table menu_items add column if not exists sort_order    int not null default 0;

alter table menu_items drop constraint if exists menu_items_station_check;
alter table menu_items add constraint menu_items_station_check
  check (station in ('kitchen', 'bar'));

-- Orders ─ one row per table's running bill.
create table if not exists orders (
  id             bigserial primary key,
  table_number   int not null,
  status         text not null default 'open',
  subtotal       numeric(10,2),
  service_charge numeric(10,2) not null default 0,
  tax            numeric(10,2) not null default 0,
  rounding       numeric(10,2) not null default 0,
  total          numeric(10,2) not null default 0,
  payment_method text,
  paid_at        timestamptz,
  created_at     timestamptz not null default now()
);
alter table orders add column if not exists subtotal       numeric(10,2);
alter table orders add column if not exists service_charge numeric(10,2) not null default 0;
alter table orders add column if not exists tax            numeric(10,2) not null default 0;
alter table orders add column if not exists rounding       numeric(10,2) not null default 0;
alter table orders add column if not exists payment_method text;
update orders set subtotal = total where subtotal is null;

-- Order items ─ each line on a bill.
create table if not exists order_items (
  id                    bigserial primary key,
  order_id              bigint not null references orders(id) on delete cascade,
  menu_item_id          bigint references menu_items(id) on delete set null,
  name_snapshot         text not null,
  name_zh_snapshot      text,
  price_at_time         numeric(10,2) not null default 0,
  cost_at_time          numeric(10,2) not null default 0,
  qty                   int not null default 1,
  kitchen_status        text not null default 'pending',
  voided_at             timestamptz,
  void_reason           text,
  voided_by             text,
  created_at            timestamptz not null default now()
);
alter table order_items add column if not exists name_zh_snapshot text;
alter table order_items add column if not exists cost_at_time     numeric(10,2) not null default 0;
alter table order_items add column if not exists voided_at        timestamptz;
alter table order_items add column if not exists void_reason      text;
alter table order_items add column if not exists voided_by        text;

-- Payments ─ cash / QR / card. Refunds are negative-amount rows.
create table if not exists payments (
  id           bigserial primary key,
  order_id     bigint not null references orders(id) on delete cascade,
  method       text not null,
  amount       numeric(10,2) not null,
  received     numeric(10,2),
  change_given numeric(10,2),
  status       text not null default 'succeeded',
  created_at   timestamptz not null default now()
);


-- ============================================================================
-- PART 2: SHOP SETTINGS (singleton)
-- ============================================================================

create table if not exists shop_settings (
  id                 int primary key default 1,
  shop_name          text not null default 'DIM SUM SHOP',
  shop_name_zh       text not null default '',
  address            text not null default '',
  sst_pct            numeric(5,2) not null default 0,
  service_charge_pct numeric(5,2) not null default 0,
  round_to_5_sen     boolean not null default true,
  updated_at         timestamptz not null default now(),
  constraint shop_settings_singleton check (id = 1)
);
insert into shop_settings (id) values (1) on conflict (id) do nothing;


-- ============================================================================
-- PART 3: PRINT JOBS QUEUE
-- ============================================================================

create table if not exists print_jobs (
  id         bigserial primary key,
  order_id   bigint,
  kind       text not null,
  station    text not null default 'kitchen',
  payload    jsonb,
  created_at timestamptz not null default now(),
  printed_at timestamptz
);
alter table print_jobs add column if not exists station text not null default 'kitchen';

alter table print_jobs drop constraint if exists print_jobs_kind_check;
alter table print_jobs add constraint print_jobs_kind_check
  check (kind in ('kitchen', 'receipt', 'void', 'refund', 'restock'));

alter table print_jobs drop constraint if exists print_jobs_station_check;
alter table print_jobs add constraint print_jobs_station_check
  check (station in ('kitchen', 'bar', 'cashier'));

update print_jobs set station = 'cashier'
  where kind in ('receipt', 'refund') and station = 'kitchen';


-- ============================================================================
-- PART 4: STAFF + AUDIT
-- ============================================================================

create table if not exists staff (
  id         bigserial primary key,
  user_id    uuid unique references auth.users(id) on delete cascade,
  name       text not null,
  pin        text not null,
  role       text not null default 'cashier',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint staff_role_check check (role in ('cashier', 'manager', 'admin'))
);

create table if not exists staff_actions (
  id         bigserial primary key,
  staff_id   bigint references staff(id) on delete set null,
  action     text not null,
  order_id   bigint,
  details    jsonb,
  created_at timestamptz not null default now()
);


-- ============================================================================
-- PART 5: END-OF-DAY (Z-report, shift float)
-- ============================================================================

create table if not exists z_reports (
  id                  bigserial primary key,
  business_date       date not null unique,
  closed_at           timestamptz not null default now(),
  closed_by_staff_id  bigint references staff(id) on delete set null,
  revenue             numeric(12,2) not null,
  order_count         int not null,
  void_count          int not null,
  payment_methods     jsonb,
  best_sellers        jsonb,
  raw                 jsonb
);

create table if not exists shift_opens (
  id             bigserial primary key,
  business_date  date not null,
  opened_at      timestamptz not null default now(),
  opened_by      text,
  opening_float  numeric(10,2) not null default 0,
  closed_at      timestamptz,
  closed_by      text,
  closing_count  numeric(10,2),
  expected_close numeric(10,2),
  variance       numeric(10,2),
  notes          text
);


-- ============================================================================
-- PART 6: RESTOCK QUEUE
-- ============================================================================

create table if not exists restock_requests (
  id                     bigserial primary key,
  menu_item_id           bigint not null references menu_items(id) on delete cascade,
  item_name_snapshot     text not null,
  item_name_zh_snapshot  text,
  qty_wanted             int,
  note                   text,
  requested_at           timestamptz not null default now(),
  requested_by           text,
  fulfilled_at           timestamptz,
  fulfilled_by           text
);


-- ============================================================================
-- PART 7: INGREDIENTS
-- ============================================================================

create table if not exists ingredients (
  id             bigserial primary key,
  name           text not null,
  name_zh        text,
  supplier       text,
  cost_price     numeric(10,2) not null default 0,
  unit           text not null default 'kg',
  stock_qty      numeric(10,2),
  low_stock_at   numeric(10,2),
  note           text,
  active         boolean not null default true,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);


-- ============================================================================
-- PART 8: INDEXES
-- ============================================================================

create index if not exists menu_items_category_idx
  on menu_items (category, sort_order, id);
create index if not exists order_items_order_idx
  on order_items (order_id);
create index if not exists orders_open_idx
  on orders (status) where paid_at is null;
create index if not exists orders_paid_at_idx
  on orders (paid_at);
create index if not exists payments_order_idx
  on payments (order_id);
create index if not exists print_jobs_pending_idx
  on print_jobs (created_at) where printed_at is null;
create index if not exists print_jobs_station_pending_idx
  on print_jobs (station, created_at) where printed_at is null;
create index if not exists restock_pending_idx
  on restock_requests (requested_at) where fulfilled_at is null;
create index if not exists shift_opens_date_idx
  on shift_opens (business_date) where closed_at is null;
create index if not exists ingredients_active_idx
  on ingredients (active, name);


-- ============================================================================
-- PART 9: ROW LEVEL SECURITY + POLICIES
-- ============================================================================

alter table menu_items      enable row level security;
alter table orders          enable row level security;
alter table order_items     enable row level security;
alter table payments        enable row level security;
alter table shop_settings   enable row level security;
alter table print_jobs      enable row level security;
alter table staff           enable row level security;
alter table staff_actions   enable row level security;
alter table z_reports       enable row level security;
alter table shift_opens     enable row level security;
alter table restock_requests enable row level security;
alter table ingredients     enable row level security;

do $$
begin
  -- Menu — read for all, write for authenticated staff
  if not exists (select 1 from pg_policies where tablename = 'menu_items' and policyname = 'menu_read_any') then
    create policy menu_read_any on menu_items for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'menu_items' and policyname = 'menu_write_auth') then
    create policy menu_write_auth on menu_items for all to authenticated using (true) with check (true);
  end if;

  -- Orders / items / payments — all reads and writes for auth
  if not exists (select 1 from pg_policies where tablename = 'orders' and policyname = 'orders_all_auth') then
    create policy orders_all_auth on orders for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'orders' and policyname = 'orders_read_anon') then
    create policy orders_read_anon on orders for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'order_items' and policyname = 'oi_all_auth') then
    create policy oi_all_auth on order_items for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'order_items' and policyname = 'oi_read_anon') then
    create policy oi_read_anon on order_items for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'payments' and policyname = 'pay_all_auth') then
    create policy pay_all_auth on payments for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'payments' and policyname = 'pay_read_anon') then
    create policy pay_read_anon on payments for select to anon using (true);
  end if;

  -- Shop settings — anon read (printer needs shop_name), auth update
  if not exists (select 1 from pg_policies where tablename = 'shop_settings' and policyname = 'settings_read_auth') then
    create policy settings_read_auth on shop_settings for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shop_settings' and policyname = 'settings_read_anon') then
    create policy settings_read_anon on shop_settings for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shop_settings' and policyname = 'settings_update_auth') then
    create policy settings_update_auth on shop_settings for update to authenticated using (true) with check (true);
  end if;

  -- Print jobs — printer-service uses anon, POS/cashier use auth
  if not exists (select 1 from pg_policies where tablename = 'print_jobs' and policyname = 'pj_read_any') then
    create policy pj_read_any on print_jobs for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'print_jobs' and policyname = 'pj_insert_auth') then
    create policy pj_insert_auth on print_jobs for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'print_jobs' and policyname = 'pj_update_any') then
    create policy pj_update_any on print_jobs for update to anon, authenticated using (true) with check (true);
  end if;

  -- Staff + audit
  if not exists (select 1 from pg_policies where tablename = 'staff' and policyname = 'staff_read_auth') then
    create policy staff_read_auth on staff for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'staff' and policyname = 'staff_write_auth') then
    create policy staff_write_auth on staff for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'staff_actions' and policyname = 'sa_read_auth') then
    create policy sa_read_auth on staff_actions for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'staff_actions' and policyname = 'sa_insert_auth') then
    create policy sa_insert_auth on staff_actions for insert to authenticated with check (true);
  end if;

  -- Z-reports + shift opens
  if not exists (select 1 from pg_policies where tablename = 'z_reports' and policyname = 'zr_all_auth') then
    create policy zr_all_auth on z_reports for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shift_opens' and policyname = 'shifts_all_auth') then
    create policy shifts_all_auth on shift_opens for all to authenticated using (true) with check (true);
  end if;

  -- Restock queue
  if not exists (select 1 from pg_policies where tablename = 'restock_requests' and policyname = 'restock_read_any') then
    create policy restock_read_any on restock_requests for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'restock_requests' and policyname = 'restock_write_auth') then
    create policy restock_write_auth on restock_requests for all to authenticated using (true) with check (true);
  end if;

  -- Ingredients
  if not exists (select 1 from pg_policies where tablename = 'ingredients' and policyname = 'ingredients_all_auth') then
    create policy ingredients_all_auth on ingredients for all to authenticated using (true) with check (true);
  end if;
end $$;


-- ============================================================================
-- PART 10: REALTIME PUBLICATIONS
-- Every table the app subscribes to in real time.
-- ============================================================================

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'menu_items', 'orders', 'order_items', 'payments',
    'shop_settings', 'print_jobs', 'restock_requests',
    'shift_opens', 'ingredients'
  ]) loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
             when others then null;
    end;
  end loop;
end $$;


-- ============================================================================
-- PART 11: SEED DATA — sensible defaults
-- ============================================================================

-- Shop settings default values (only fills if you haven't set them).
update shop_settings
   set shop_name     = coalesce(nullif(shop_name, ''),      'Dim Sum House'),
       shop_name_zh  = coalesce(nullif(shop_name_zh, ''),   '點心館'),
       sst_pct       = coalesce(nullif(sst_pct, 0),         6),
       round_to_5_sen = true
 where id = 1;

-- Starter menu — dim sum classics with realistic cost/price and station tags.
-- Existing menu items are untouched (matched by name_en).
insert into menu_items (name_en, name_zh, price, cost_price, category, station, sort_order) values
  -- STEAMED (kitchen)
  ('Har Gow',                '虾饺',      7.80, 3.20, 'Steamed', 'kitchen', 10),
  ('Siu Mai',                '烧卖',      6.80, 2.60, 'Steamed', 'kitchen', 20),
  ('Char Siu Bao',           '叉烧包',    6.50, 2.20, 'Steamed', 'kitchen', 30),
  ('Lo Mai Gai',             '糯米鸡',    8.80, 3.40, 'Steamed', 'kitchen', 40),
  ('Chicken Feet',           '凤爪',      6.80, 2.40, 'Steamed', 'kitchen', 50),
  ('Xiao Long Bao',          '小笼包',    9.80, 3.80, 'Steamed', 'kitchen', 60),
  -- FRIED (kitchen)
  ('Spring Roll',            '春卷',      6.00, 2.00, 'Fried',   'kitchen', 10),
  ('Wu Kok (Yam Puff)',      '芋角',      6.80, 2.40, 'Fried',   'kitchen', 20),
  ('Radish Cake',            '萝卜糕',    6.80, 2.20, 'Fried',   'kitchen', 30),
  -- RICE NOODLE (kitchen)
  ('Cheong Fun (Prawn)',     '虾肠粉',    8.80, 3.20, 'Rice Noodle', 'kitchen', 10),
  ('Cheong Fun (Char Siu)',  '叉烧肠粉',  8.80, 3.00, 'Rice Noodle', 'kitchen', 20),
  -- CONGEE (kitchen)
  ('Century Egg Congee',     '皮蛋粥',    8.00, 2.20, 'Congee',  'kitchen', 10),
  -- DESSERT (kitchen)
  ('Egg Tart',               '蛋挞',      4.50, 1.50, 'Dessert', 'kitchen', 10),
  ('Mango Pudding',          '芒果布丁',  5.80, 1.80, 'Dessert', 'kitchen', 20),
  -- DRINKS (bar)
  ('Chinese Tea',            '中国茶',    2.00, 0.30, 'Drinks',  'bar',     10),
  ('Chrysanthemum Tea',      '菊花茶',    3.50, 0.60, 'Drinks',  'bar',     20),
  ('Iced Lemon Tea',         '柠檬冰茶',  5.80, 1.20, 'Drinks',  'bar',     30),
  ('Soy Milk',               '豆奶',      4.50, 0.80, 'Drinks',  'bar',     40),
  ('Bottled Water',          '瓶装水',    3.00, 0.80, 'Drinks',  'bar',     50)
on conflict do nothing;

-- Starter ingredients — sample raw materials.
insert into ingredients (name, name_zh, cost_price, unit, supplier) values
  ('Prawns',        '虾',     42.00, 'kg',    'Wholesale wet market'),
  ('Pork (belly)',  '五花肉', 22.00, 'kg',    'Butcher'),
  ('Char Siu',      '叉烧',   38.00, 'kg',    'Own kitchen'),
  ('Wheat flour',   '面粉',    2.80, 'kg',    'Baking supplier'),
  ('Rice flour',    '米粉',    4.50, 'kg',    'Baking supplier'),
  ('Chicken feet',  '凤爪',   14.00, 'kg',    'Wet market'),
  ('Egg tart shell','蛋挞皮',  0.35, 'piece', 'Bakery supplier'),
  ('Yam',           '芋头',    6.00, 'kg',    'Wet market'),
  ('Chinese tea leaves', '茶叶', 60.00, 'kg',  'Tea supplier'),
  ('Lemon',         '柠檬',    8.00, 'kg',    'Wet market'),
  ('Soy milk (bulk)','豆奶',   3.50, 'l',     'Dairy supplier'),
  ('Bottled water', '瓶装水',  0.75, 'piece', 'Beverage supplier')
on conflict do nothing;


-- ============================================================================
-- DONE. You can now:
--   1. Create a staff user in Supabase → Authentication → Users
--   2. Insert your first admin staff row in this table (Table Editor → staff)
--   3. Open the POS at /login and sign in
-- ============================================================================
