-- ============================================================================
--  FUHAO DIM SUM POS  —  RESET AND SEED
--
--  ⚠️  DESTRUCTIVE ⚠️
--
--  This script:
--    1. DELETES every existing POS table (data + schema)
--    2. Recreates the schema fresh
--    3. Seeds a full demo dataset — 33 menu items, 4 staff, 30 days of
--       orders + expenses, audit log entries, restock requests
--
--  Run this ONLY when you want to start over.  It is NOT reversible.
--
--  How to run:
--    Supabase → SQL Editor → New query → paste this whole file → Run.
--
--  Storage buckets and their photos are NOT touched.  If you want to
--  clear those too, do it manually in Supabase → Storage.
-- ============================================================================


-- ============================================================================
--  SECTION 1.  DROP EVERYTHING
--
--  `cascade` drops dependent policies, indexes and constraints too.
-- ============================================================================

drop table if exists audit_log         cascade;
drop table if exists expenses          cascade;
drop table if exists restock_requests  cascade;
drop table if exists shift_opens       cascade;
drop table if exists z_reports         cascade;
drop table if exists staff_actions     cascade;
drop table if exists payments          cascade;
drop table if exists order_items       cascade;
drop table if exists orders            cascade;
drop table if exists print_jobs        cascade;
drop table if exists menu_items        cascade;
drop table if exists staff             cascade;
drop table if exists shop_settings     cascade;
drop table if exists ingredients       cascade;  -- legacy


-- ============================================================================
--  SECTION 2.  CREATE SCHEMA
-- ============================================================================

-- 2.1  Menu, orders, order items, payments -----------------------------------

create table menu_items (
  id                     bigserial primary key,
  name_en                text not null,
  name_zh                text,
  price                  numeric(10,2) not null default 0,
  image_url              text,
  category               text not null default 'Other',
  station                text not null default 'kitchen',
  is_available           boolean not null default true,
  temporarily_disabled   boolean not null default false,
  options_available      jsonb not null default '[]'::jsonb,
  sort_order             int not null default 0,
  created_at             timestamptz not null default now(),
  constraint menu_items_station_check check (station in ('kitchen', 'bar'))
);

create table orders (
  id              bigserial primary key,
  table_number    int not null,
  status          text not null default 'open',
  subtotal        numeric(10,2),
  service_charge  numeric(10,2) not null default 0,
  tax             numeric(10,2) not null default 0,
  rounding        numeric(10,2) not null default 0,
  discount        numeric(10,2) not null default 0,
  discount_reason text,
  total           numeric(10,2) not null default 0,
  payment_method  text,
  voided_at       timestamptz,
  void_reason     text,
  voided_by       text,
  refunded_at     timestamptz,
  refund_reason   text,
  refunded_by     text,
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);

create table order_items (
  id                    bigserial primary key,
  order_id              bigint not null references orders(id) on delete cascade,
  menu_item_id          bigint references menu_items(id) on delete set null,
  name_snapshot         text not null,
  name_zh_snapshot      text,
  price_at_time         numeric(10,2) not null default 0,
  qty                   int not null default 1,
  options               text,
  note                  text,
  kitchen_status        text not null default 'pending',
  voided_at             timestamptz,
  void_reason           text,
  voided_by             text,
  created_at            timestamptz not null default now()
);

create table payments (
  id           bigserial primary key,
  order_id     bigint not null references orders(id) on delete cascade,
  method       text not null,
  amount       numeric(10,2) not null,
  received     numeric(10,2),
  change_given numeric(10,2),
  status       text not null default 'succeeded',
  created_at   timestamptz not null default now()
);

-- 2.2  Shop settings (singleton) ---------------------------------------------

create table shop_settings (
  id                 int primary key default 1,
  shop_name          text not null default 'FuHao Dim Sum',
  shop_name_zh       text not null default '福豪點心',
  address            text not null default '',
  sst_pct            numeric(5,2) not null default 6,
  service_charge_pct numeric(5,2) not null default 0,
  round_to_5_sen     boolean not null default true,
  updated_at         timestamptz not null default now(),
  constraint shop_settings_singleton check (id = 1)
);
insert into shop_settings (id) values (1);

-- 2.3  Print jobs queue ------------------------------------------------------

create table print_jobs (
  id         bigserial primary key,
  order_id   bigint,
  kind       text not null,
  station    text not null default 'kitchen',
  payload    jsonb,
  created_at timestamptz not null default now(),
  printed_at timestamptz,
  constraint print_jobs_kind_check check (kind in ('kitchen', 'receipt', 'void', 'refund', 'restock')),
  constraint print_jobs_station_check check (station in ('kitchen', 'bar', 'cashier'))
);

-- 2.4  Staff + audit log ------------------------------------------------------

create table staff (
  id             bigserial primary key,
  user_id        uuid unique references auth.users(id) on delete cascade,
  name           text not null,
  pin            text not null,
  role           text not null default 'cashier',
  monthly_salary numeric(10,2),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint staff_role_check check (role in ('cashier', 'supervisor', 'owner'))
);

create table staff_actions (
  id         bigserial primary key,
  staff_id   bigint references staff(id) on delete set null,
  action     text not null,
  order_id   bigint,
  details    jsonb,
  created_at timestamptz not null default now()
);

create table audit_log (
  id           bigserial primary key,
  actor_email  text,
  actor_role   text,
  action       text not null,
  target_type  text,
  target_id    bigint,
  amount       numeric(10,2),
  reason       text,
  details      jsonb,
  created_at   timestamptz not null default now()
);

-- 2.5  End of day / shift ----------------------------------------------------

create table z_reports (
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

create table shift_opens (
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

-- 2.6  Restock queue ---------------------------------------------------------

create table restock_requests (
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

-- 2.7  Expenses --------------------------------------------------------------

create table expenses (
  id              bigserial primary key,
  kind            text not null,
  business_date   date not null,
  amount          numeric(10,2) not null,
  payment_method  text,
  description     text,
  supplier        text,
  receipt_url     text,
  staff_id        bigint references staff(id) on delete set null,
  staff_name      text,
  hours           numeric(6,2),
  normal_wage     numeric(10,2),
  ot_amount       numeric(10,2),
  other_amount    numeric(10,2),
  note            text,
  created_by      text,
  created_at      timestamptz not null default now(),
  constraint expenses_kind_check check (
    kind in ('wages', 'meal', 'purchase', 'other', 'rent', 'utility')
  )
);

-- 2.8  Indexes ---------------------------------------------------------------

create index menu_items_category_idx      on menu_items (category, sort_order, id);
create index order_items_order_idx        on order_items (order_id);
create index orders_open_idx              on orders (status) where paid_at is null;
create index orders_paid_at_idx           on orders (paid_at);
create index payments_order_idx           on payments (order_id);
create index print_jobs_pending_idx       on print_jobs (created_at) where printed_at is null;
create index print_jobs_station_pending_idx on print_jobs (station, created_at) where printed_at is null;
create index restock_pending_idx          on restock_requests (requested_at) where fulfilled_at is null;
create index shift_opens_date_idx         on shift_opens (business_date) where closed_at is null;
create index expenses_date_idx            on expenses (business_date, kind);
create index expenses_kind_idx            on expenses (kind, business_date);
create index audit_log_date_idx           on audit_log (created_at desc);
create index audit_log_action_idx         on audit_log (action, created_at desc);


-- ============================================================================
--  SECTION 3.  ROW LEVEL SECURITY
-- ============================================================================

alter table menu_items       enable row level security;
alter table orders           enable row level security;
alter table order_items      enable row level security;
alter table payments         enable row level security;
alter table shop_settings    enable row level security;
alter table print_jobs       enable row level security;
alter table staff            enable row level security;
alter table staff_actions    enable row level security;
alter table z_reports        enable row level security;
alter table shift_opens      enable row level security;
alter table restock_requests enable row level security;
alter table expenses         enable row level security;
alter table audit_log        enable row level security;

create policy menu_read_any        on menu_items       for select to anon, authenticated  using (true);
create policy menu_write_auth      on menu_items       for all    to authenticated        using (true) with check (true);

create policy orders_all_auth      on orders           for all    to authenticated        using (true) with check (true);
create policy orders_read_anon     on orders           for select to anon                 using (true);
create policy oi_all_auth          on order_items      for all    to authenticated        using (true) with check (true);
create policy oi_read_anon         on order_items      for select to anon                 using (true);
create policy pay_all_auth         on payments         for all    to authenticated        using (true) with check (true);
create policy pay_read_anon        on payments         for select to anon                 using (true);

create policy settings_read_auth   on shop_settings    for select to authenticated        using (true);
create policy settings_read_anon   on shop_settings    for select to anon                 using (true);
create policy settings_update_auth on shop_settings    for update to authenticated        using (true) with check (true);

create policy pj_read_any          on print_jobs       for select to anon, authenticated  using (true);
create policy pj_insert_auth       on print_jobs       for insert to authenticated        with check (true);
create policy pj_update_any        on print_jobs       for update to anon, authenticated  using (true) with check (true);

create policy staff_read_auth      on staff            for select to authenticated        using (true);
create policy staff_write_auth     on staff            for all    to authenticated        using (true) with check (true);
create policy sa_read_auth         on staff_actions    for select to authenticated        using (true);
create policy sa_insert_auth       on staff_actions    for insert to authenticated        with check (true);

create policy zr_all_auth          on z_reports        for all    to authenticated        using (true) with check (true);
create policy shifts_all_auth      on shift_opens      for all    to authenticated        using (true) with check (true);

create policy restock_read_any     on restock_requests for select to anon, authenticated  using (true);
create policy restock_write_auth   on restock_requests for all    to authenticated        using (true) with check (true);

create policy expenses_all_auth    on expenses         for all    to authenticated        using (true) with check (true);

create policy audit_read_auth      on audit_log        for select to authenticated        using (true);
create policy audit_insert_auth    on audit_log        for insert to authenticated        with check (true);


-- ============================================================================
--  SECTION 4.  REALTIME PUBLICATIONS
-- ============================================================================

do $$
declare t text;
begin
  for t in select unnest(array[
    'menu_items', 'orders', 'order_items', 'payments',
    'shop_settings', 'print_jobs', 'restock_requests',
    'shift_opens', 'expenses'
  ]) loop
    begin execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
             when others then null;
    end;
  end loop;
end $$;


-- ============================================================================
--  SECTION 5.  STORAGE BUCKETS + POLICIES
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('menu-photos',      'menu-photos',      true, 5242880,
     array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('expense-receipts', 'expense-receipts', true, 8388608,
     array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'menu_photos_read_any') then
    create policy menu_photos_read_any   on storage.objects for select to anon, authenticated using (bucket_id = 'menu-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'menu_photos_insert_auth') then
    create policy menu_photos_insert_auth on storage.objects for insert to authenticated with check (bucket_id = 'menu-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'menu_photos_update_auth') then
    create policy menu_photos_update_auth on storage.objects for update to authenticated using (bucket_id = 'menu-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'menu_photos_delete_auth') then
    create policy menu_photos_delete_auth on storage.objects for delete to authenticated using (bucket_id = 'menu-photos');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'receipts_read_auth') then
    create policy receipts_read_auth     on storage.objects for select to anon, authenticated using (bucket_id = 'expense-receipts');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'receipts_insert_auth') then
    create policy receipts_insert_auth   on storage.objects for insert to authenticated with check (bucket_id = 'expense-receipts');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'receipts_delete_auth') then
    create policy receipts_delete_auth   on storage.objects for delete to authenticated using (bucket_id = 'expense-receipts');
  end if;
end $$;


-- ============================================================================
--  SECTION 6.  SEED DATA — Menu items (33 across 7 categories)
-- ============================================================================

insert into menu_items (name_en, name_zh, price, category, station, sort_order) values
  -- 點心 Dim Sum
  ('Siu Mai',           '燒賣',        7.80, 'Dim Sum', 'kitchen',  10),
  ('Har Gow',           '蝦餃',        8.80, 'Dim Sum', 'kitchen',  20),
  ('Chicken Feet',      '鳳爪',        7.80, 'Dim Sum', 'kitchen',  30),
  ('Spare Ribs',        '排骨',        8.50, 'Dim Sum', 'kitchen',  40),
  ('Turnip Cake',       '蘿蔔糕',      7.20, 'Dim Sum', 'kitchen',  50),
  ('Spring Roll',       '春卷',        6.80, 'Dim Sum', 'kitchen',  60),
  ('Lotus Leaf Rice',   '糯米雞',      9.50, 'Dim Sum', 'kitchen',  70),
  ('Fried Dumpling',    '鹹水角',      6.80, 'Dim Sum', 'kitchen',  80),
  -- 包點 Buns
  ('Char Siu Bao',      '叉燒包',      6.80, 'Buns',    'kitchen',  10),
  ('Meat Bun',          '肉包',        5.80, 'Buns',    'kitchen',  20),
  ('Chicken Bun',       '雞肉包',      5.80, 'Buns',    'kitchen',  30),
  ('Lotus Paste Bun',   '蓮蓉包',      5.20, 'Buns',    'kitchen',  40),
  ('Custard Bun',       '奶皇包',      6.20, 'Buns',    'kitchen',  50),
  -- 飯類 Rice
  ('Fried Rice',        '炒飯',       12.80, 'Rice',    'kitchen',  10),
  ('Chicken Rice',      '雞飯',       11.80, 'Rice',    'kitchen',  20),
  ('Yang Chow Rice',    '揚州炒飯',   13.80, 'Rice',    'kitchen',  30),
  ('Salted Fish Rice',  '鹹魚雞粒炒飯', 14.80, 'Rice',  'kitchen',  40),
  -- 面/炒類 Noodles
  ('Fried Noodles',     '炒麵',       12.50, 'Noodles', 'kitchen',  10),
  ('Char Kway Teow',    '炒粿條',     13.50, 'Noodles', 'kitchen',  20),
  ('Noodle Soup',       '湯麵',       11.50, 'Noodles', 'kitchen',  30),
  ('Wonton Noodles',    '雲吞麵',     12.80, 'Noodles', 'kitchen',  40),
  ('Dry Noodles',       '乾撈麵',     11.80, 'Noodles', 'kitchen',  50),
  -- 飲料 Drinks (bar printer)
  ('Chinese Tea',       '中國茶',      2.50, 'Drinks',  'bar',      10),
  ('Coffee',            '咖啡',        3.50, 'Drinks',  'bar',      20),
  ('Milk Tea',          '奶茶',        4.50, 'Drinks',  'bar',      30),
  ('Soy Milk',          '豆漿',        3.20, 'Drinks',  'bar',      40),
  ('Chrysanthemum Tea', '菊花茶',      3.50, 'Drinks',  'bar',      50),
  -- 燒味 Roasted
  ('Char Siu',          '叉燒',       18.80, 'Roasted', 'kitchen',  10),
  ('Roast Pork',        '燒肉',       19.80, 'Roasted', 'kitchen',  20),
  ('Roast Chicken',     '燒雞',       22.80, 'Roasted', 'kitchen',  30),
  ('Roast Duck',        '燒鴨',       28.80, 'Roasted', 'kitchen',  40),
  -- 其他 Other
  ('Mango Pudding',     '芒果布丁',    5.80, 'Other',   'kitchen',  10),
  ('Tong Sui',          '糖水',        4.50, 'Other',   'kitchen',  20);

-- Modifiers on a handful of items
update menu_items set options_available = '[
  {"label": "No shrimp",   "label_zh": "不蝦"},
  {"label": "Extra sauce", "label_zh": "多醬"}
]'::jsonb where name_en in ('Siu Mai', 'Har Gow');

update menu_items set options_available = '[
  {"label": "Less sugar",  "label_zh": "少糖"},
  {"label": "No ice",      "label_zh": "不加冰"},
  {"label": "Hot",         "label_zh": "熱"}
]'::jsonb where category = 'Drinks';

update menu_items set options_available = '[
  {"label": "Extra chilli", "label_zh": "多辣"},
  {"label": "Less oil",     "label_zh": "少油"},
  {"label": "No coriander", "label_zh": "不香菜"}
]'::jsonb where category in ('Rice', 'Noodles');


-- ============================================================================
--  SECTION 7.  SEED DATA — Staff (4 accounts across all 3 role tiers)
-- ============================================================================

insert into staff (name, pin, role, monthly_salary, active) values
  ('Ah Kong (Owner)',   '9999', 'owner',      3500, true),
  ('Uncle Wong (Sup)',  '5555', 'supervisor', 2800, true),
  ('Mei Ling',          '1111', 'cashier',    2200, true),
  ('Sarah',             '2222', 'cashier',    2200, true);


-- ============================================================================
--  SECTION 8.  SEED DATA — 30 days of orders + payments
-- ============================================================================

do $$
declare
  d              date;
  order_count    int;
  order_id_new   bigint;
  n_items        int;
  total_amt      numeric(10,2);
  paid_time      timestamptz;
  method         text;
  menu_ids       bigint[];
  menu_prices    numeric(10,2)[];
  menu_names     text[];
  menu_names_zh  text[];
  chosen_idx     int;
  i              int;
  j              int;
  d_idx          int;
  qty            int;
  price          numeric(10,2);
  subtotal_amt   numeric(10,2);
  discount_amt   numeric(10,2);
  table_no       int;
  rand_val       numeric;
  seed_marker    text := '[DEMO]';
begin
  -- Aliased with `m` so `m.price` doesn't collide with the local `price` var.
  select array_agg(m.id      order by m.id),
         array_agg(m.price   order by m.id),
         array_agg(m.name_en order by m.id),
         array_agg(m.name_zh order by m.id)
    into menu_ids, menu_prices, menu_names, menu_names_zh
    from menu_items m;

  for d_idx in 0..29 loop
    d := (current_date - d_idx)::date;
    order_count := 8 + floor(random() * 11)::int;

    for j in 1..order_count loop
      n_items := 1 + floor(random() * 6)::int;
      subtotal_amt := 0;
      table_no := 1 + floor(random() * 25)::int;

      rand_val := random();
      paid_time := d::timestamptz + (
        case
          when rand_val < 0.55 then interval '10 hours' + (random() * interval '4 hours')
          when rand_val < 0.90 then interval '17 hours' + (random() * interval '3 hours')
          else                       interval '15 hours' + (random() * interval '2 hours')
        end
      );

      rand_val := random();
      method := case
        when rand_val < 0.40 then 'cash'
        when rand_val < 0.80 then 'duitnow_qr'
        when rand_val < 0.95 then 'card'
        else 'bank_transfer'
      end;

      insert into orders (
        table_number, status, subtotal, service_charge, tax, rounding,
        discount, total, payment_method, paid_at, created_at
      ) values (
        table_no, 'paid', 0, 0, 0, 0, 0, 0, method, paid_time, paid_time
      )
      returning id into order_id_new;

      for i in 1..n_items loop
        chosen_idx := 1 + floor(random() * array_length(menu_ids, 1))::int;
        qty := 1 + floor(random() * 3)::int;
        price := menu_prices[chosen_idx];
        subtotal_amt := subtotal_amt + (price * qty);

        insert into order_items (
          order_id, menu_item_id, name_snapshot, name_zh_snapshot,
          price_at_time, qty, kitchen_status, created_at
        ) values (
          order_id_new, menu_ids[chosen_idx],
          menu_names[chosen_idx], menu_names_zh[chosen_idx],
          price, qty, 'ready', paid_time
        );
      end loop;

      discount_amt := 0;
      if random() < 0.10 then
        discount_amt := round((subtotal_amt * 0.10)::numeric, 2);
        update orders
           set discount = discount_amt,
               discount_reason = seed_marker || ' Regular customer 10%'
         where id = order_id_new;
      end if;

      total_amt := subtotal_amt - discount_amt;

      update orders
         set subtotal = subtotal_amt, total = total_amt
       where id = order_id_new;

      insert into payments (order_id, method, amount, status, created_at)
      values (order_id_new, method, total_amt, 'succeeded', paid_time);
    end loop;
  end loop;
end $$;


-- ============================================================================
--  SECTION 9.  SEED DATA — voided + refunded orders
-- ============================================================================

update orders
   set status      = 'void',
       voided_at   = current_timestamp - interval '3 days',
       voided_by   = 'demo-supervisor@fuhao',
       void_reason = '[DEMO] Customer changed mind'
 where id in (
   select id from orders
    where paid_at::date = current_date - 3
    order by id desc
    limit 2
 );

update orders
   set status        = 'refunded',
       refunded_at   = current_timestamp - interval '7 days',
       refunded_by   = 'demo-owner@fuhao',
       refund_reason = '[DEMO] Wrong order, refunded in cash'
 where id in (
   select id from orders where paid_at::date = current_date - 7 order by id desc limit 1
 );


-- ============================================================================
--  SECTION 10.  SEED DATA — 30 days of expenses
-- ============================================================================

do $$
declare
  d     date;
  seed  text := '[DEMO]';
  d_idx int;
begin
  for d_idx in 0..29 loop
    d := (current_date - d_idx)::date;

    -- Daily purchase
    insert into expenses (kind, business_date, amount, payment_method, description, supplier, note, created_by, created_at)
    values (
      'purchase', d, (600 + random() * 700)::numeric(10,2), 'cash',
      seed || ' Meat + Seafood', 'Uncle Lim (Market)',
      seed || ' auto-seeded', 'demo-owner@fuhao',
      d::timestamptz + interval '7 hours'
    );

    if random() < 0.5 then
      insert into expenses (kind, business_date, amount, payment_method, description, supplier, note, created_by, created_at)
      values (
        'purchase', d, (100 + random() * 200)::numeric(10,2), 'duitnow_qr',
        seed || ' Vegetables', 'Ah Choo Vege',
        seed || ' auto-seeded', 'demo-owner@fuhao',
        d::timestamptz + interval '7 hours 30 minutes'
      );
    end if;

    -- Daily wages (2 daily-paid cooks)
    insert into expenses (kind, business_date, amount, payment_method, staff_name, hours, normal_wage, ot_amount, note, created_by, created_at)
    values
      ('wages', d, 80.00, 'cash', 'Ah Hock (Cook)',      8, 80, 0, seed || ' auto-seeded', 'demo-owner@fuhao', d::timestamptz + interval '21 hours'),
      ('wages', d, 75.00, 'cash', 'Ah Fatt (Kitchen)',   8, 75, 0, seed || ' auto-seeded', 'demo-owner@fuhao', d::timestamptz + interval '21 hours 5 minutes');

    -- Daily staff meal
    insert into expenses (kind, business_date, amount, payment_method, description, note, created_by, created_at)
    values (
      'meal', d, (60 + random() * 30)::numeric(10,2), 'cash',
      seed || ' 6 staff meals', seed || ' auto-seeded', 'demo-owner@fuhao',
      d::timestamptz + interval '13 hours'
    );

    -- Weekly other expense on Sundays
    if extract(dow from d) = 0 then
      insert into expenses (kind, business_date, amount, payment_method, description, note, created_by, created_at)
      values (
        'other', d, (40 + random() * 40)::numeric(10,2), 'cash',
        seed || ' Cleaning supplies & packaging', seed || ' auto-seeded',
        'demo-owner@fuhao', d::timestamptz + interval '11 hours'
      );
    end if;
  end loop;

  -- Monthly rent — 1st of current month
  insert into expenses (kind, business_date, amount, payment_method, description, note, created_by, created_at)
  values (
    'rent', date_trunc('month', current_date)::date, 3500.00, 'bank_transfer',
    seed || ' Shop rent — ' || to_char(current_date, 'FMMonth YYYY'),
    seed || ' auto-seeded', 'demo-owner@fuhao',
    date_trunc('month', current_date)::timestamptz + interval '9 hours'
  );

  -- Monthly utility — 15th of current month, only if we're past it
  if current_date >= (date_trunc('month', current_date) + interval '14 days')::date then
    insert into expenses (kind, business_date, amount, payment_method, description, note, created_by, created_at)
    values (
      'utility',
      (date_trunc('month', current_date) + interval '14 days')::date,
      (480 + random() * 120)::numeric(10,2), 'card',
      seed || ' TNB electricity bill', seed || ' auto-seeded', 'demo-owner@fuhao',
      (date_trunc('month', current_date) + interval '14 days')::timestamptz + interval '10 hours'
    );
  end if;
end $$;


-- ============================================================================
--  SECTION 11.  SEED DATA — audit log + restock requests
-- ============================================================================

insert into audit_log (actor_email, actor_role, action, target_type, target_id, amount, reason, created_at)
select v.email, v.role, v.action, v.target_type, v.target_id, v.amount,
       '[DEMO] ' || v.reason,
       current_timestamp - (v.days_ago || ' days')::interval
from (values
  ('demo-supervisor@fuhao', 'supervisor', 'void',           'order',     1001::bigint, 42.60::numeric,  'Customer changed mind',    3),
  ('demo-supervisor@fuhao', 'supervisor', 'discount',       'order',     1005::bigint,  3.80::numeric,  'Regular customer 10%',     2),
  ('demo-owner@fuhao',      'owner',      'refund',         'order',     1010::bigint, 28.00::numeric,  'Wrong order, refunded',    7),
  ('demo-owner@fuhao',      'owner',      'price_change',   'menu_item',    1::bigint,  null::numeric,  'Char Siu Bao: 6.50 → 6.80', 5),
  ('demo-owner@fuhao',      'owner',      'menu_item_delete','menu_item', 999::bigint,  null::numeric,  'Removed old item',        14)
) as v(email, role, action, target_type, target_id, amount, reason, days_ago);

insert into restock_requests (menu_item_id, item_name_snapshot, item_name_zh_snapshot, qty_wanted, note, requested_at, requested_by)
select m.id, m.name_en, m.name_zh, 2, '[DEMO] Front tray almost empty',
       current_timestamp - interval '30 minutes', 'demo-cashier@fuhao'
  from menu_items m
 where m.name_en in ('Char Siu Bao', 'Har Gow', 'Siu Mai');


-- ============================================================================
--  SECTION 12.  RELOAD POSTGREST SCHEMA CACHE
-- ============================================================================

notify pgrst, 'reload schema';


-- ============================================================================
--  ALL DONE.
--
--  ✓ Every table was recreated fresh
--  ✓ 33 menu items across 7 categories with modifiers
--  ✓ 4 staff (owner · supervisor · 2 cashiers)  PINs: 9999 / 5555 / 1111 / 2222
--  ✓ ~350 orders across 30 days with realistic peak-hour distribution
--  ✓ 2 voided orders + 1 refunded order for the audit page
--  ✓ 30 days of purchases, wages, meals, plus monthly rent + utility
--  ✓ Audit log entries and 3 pending restock requests
--
--  Now click through:  /   /admin   /admin/expenses   /admin/monthly-report
--                      /admin/rankings   /admin/audit-log
-- ============================================================================
