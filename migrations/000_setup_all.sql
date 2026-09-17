-- ============================================================================
-- FuHao Dim Sum POS — Master Setup / Catch-up
--
-- Brings ANY Supabase project to the current schema in one paste.
-- Idempotent: safe on a fresh project AND on a partly-migrated one.
-- Run in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================================


-- ============================================================================
-- 1. BASE TABLES
-- ============================================================================

create table if not exists menu_items (
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
  created_at             timestamptz not null default now()
);
alter table menu_items add column if not exists name_zh              text;
alter table menu_items add column if not exists image_url            text;
alter table menu_items add column if not exists category             text not null default 'Other';
alter table menu_items add column if not exists station              text not null default 'kitchen';
alter table menu_items add column if not exists is_available         boolean not null default true;
alter table menu_items add column if not exists temporarily_disabled boolean not null default false;
alter table menu_items add column if not exists options_available    jsonb   not null default '[]'::jsonb;
alter table menu_items add column if not exists sort_order           int     not null default 0;

-- Legacy columns that were removed
alter table menu_items drop column if exists cost_price;

alter table menu_items drop constraint if exists menu_items_station_check;
alter table menu_items add constraint menu_items_station_check
  check (station in ('kitchen', 'bar'));

create table if not exists orders (
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
alter table orders add column if not exists subtotal        numeric(10,2);
alter table orders add column if not exists service_charge  numeric(10,2) not null default 0;
alter table orders add column if not exists tax             numeric(10,2) not null default 0;
alter table orders add column if not exists rounding        numeric(10,2) not null default 0;
alter table orders add column if not exists discount        numeric(10,2) not null default 0;
alter table orders add column if not exists discount_reason text;
alter table orders add column if not exists payment_method  text;
alter table orders add column if not exists voided_at       timestamptz;
alter table orders add column if not exists void_reason     text;
alter table orders add column if not exists voided_by       text;
alter table orders add column if not exists refunded_at     timestamptz;
alter table orders add column if not exists refund_reason   text;
alter table orders add column if not exists refunded_by     text;
update orders set subtotal = total where subtotal is null;

create table if not exists order_items (
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
alter table order_items add column if not exists name_zh_snapshot text;
alter table order_items add column if not exists options          text;
alter table order_items add column if not exists note             text;
alter table order_items add column if not exists voided_at        timestamptz;
alter table order_items add column if not exists void_reason      text;
alter table order_items add column if not exists voided_by        text;

-- Legacy column removed
alter table order_items drop column if exists cost_at_time;

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
-- 2. SHOP SETTINGS (singleton)
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
-- 3. PRINT JOBS QUEUE
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
-- 4. STAFF + AUDIT
-- ============================================================================

create table if not exists staff (
  id         bigserial primary key,
  user_id    uuid unique references auth.users(id) on delete cascade,
  name       text not null,
  pin        text not null,
  role       text not null default 'cashier',
  monthly_salary numeric(10,2),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table staff add column if not exists monthly_salary numeric(10,2);
alter table staff drop constraint if exists staff_role_check;
alter table staff add constraint staff_role_check
  check (role in ('cashier', 'supervisor', 'owner'));
-- Migrate old role names to the new tiers
update staff set role = 'supervisor' where role = 'manager';
update staff set role = 'owner'      where role = 'admin';

-- Legacy staff_actions kept for old data; new audit log below.
create table if not exists staff_actions (
  id         bigserial primary key,
  staff_id   bigint references staff(id) on delete set null,
  action     text not null,
  order_id   bigint,
  details    jsonb,
  created_at timestamptz not null default now()
);


-- ============================================================================
-- 5. END-OF-DAY (Z-report, shift float)
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
-- 6. RESTOCK QUEUE
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
-- 7. EXPENSES — daily and monthly (wages, meals, purchases, other, rent, utility)
-- ============================================================================
--
-- One flexible table for every non-sales cost.  The `kind` column says what
-- kind of row it is; unused columns just stay null.  Owner never has to guess
-- which food each purchase belongs to — purchases are simply a total for the
-- day, per the client's spec.
-- ============================================================================

create table if not exists expenses (
  id              bigserial primary key,
  kind            text not null,
  business_date   date not null,
  amount          numeric(10,2) not null,
  payment_method  text,               -- cash | duitnow_qr | card | bank_transfer | other
  description     text,               -- free-text description / label
  supplier        text,               -- for purchases: supplier or market name
  receipt_url     text,               -- optional photo of invoice
  -- Wages-specific
  staff_id        bigint references staff(id) on delete set null,
  staff_name      text,               -- snapshot in case the staff row is deleted
  hours           numeric(6,2),
  normal_wage     numeric(10,2),
  ot_amount       numeric(10,2),
  other_amount    numeric(10,2),
  note            text,
  created_by      text,               -- email of user who entered the row
  created_at      timestamptz not null default now(),
  constraint expenses_kind_check check (
    kind in ('wages', 'meal', 'purchase', 'other', 'rent', 'utility')
  )
);
create index if not exists expenses_date_idx  on expenses (business_date, kind);
create index if not exists expenses_kind_idx  on expenses (kind, business_date);


-- ============================================================================
-- 8. AUDIT LOG — void / refund / discount / price change / expense delete
-- ============================================================================
--
-- Every sensitive action leaves a row here.  Immutable from the app side.
-- Owner can review who did what and why.
-- ============================================================================

create table if not exists audit_log (
  id           bigserial primary key,
  actor_email  text,
  actor_role   text,
  action       text not null,      -- 'void' | 'refund' | 'discount' | 'price_change' | 'expense_delete' | ...
  target_type  text,                -- 'order' | 'order_item' | 'menu_item' | 'expense'
  target_id    bigint,
  amount       numeric(10,2),
  reason       text,
  details      jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists audit_log_date_idx on audit_log (created_at desc);
create index if not exists audit_log_action_idx on audit_log (action, created_at desc);


-- ============================================================================
-- 9. INDEXES on core tables
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


-- ============================================================================
-- 10. ROW LEVEL SECURITY
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

do $$
begin
  -- menu
  if not exists (select 1 from pg_policies where tablename = 'menu_items' and policyname = 'menu_read_any') then
    create policy menu_read_any on menu_items for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'menu_items' and policyname = 'menu_write_auth') then
    create policy menu_write_auth on menu_items for all to authenticated using (true) with check (true);
  end if;

  -- orders / items / payments
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

  -- settings
  if not exists (select 1 from pg_policies where tablename = 'shop_settings' and policyname = 'settings_read_auth') then
    create policy settings_read_auth on shop_settings for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shop_settings' and policyname = 'settings_read_anon') then
    create policy settings_read_anon on shop_settings for select to anon using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shop_settings' and policyname = 'settings_update_auth') then
    create policy settings_update_auth on shop_settings for update to authenticated using (true) with check (true);
  end if;

  -- print jobs
  if not exists (select 1 from pg_policies where tablename = 'print_jobs' and policyname = 'pj_read_any') then
    create policy pj_read_any on print_jobs for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'print_jobs' and policyname = 'pj_insert_auth') then
    create policy pj_insert_auth on print_jobs for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'print_jobs' and policyname = 'pj_update_any') then
    create policy pj_update_any on print_jobs for update to anon, authenticated using (true) with check (true);
  end if;

  -- staff
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

  -- z-report / shifts
  if not exists (select 1 from pg_policies where tablename = 'z_reports' and policyname = 'zr_all_auth') then
    create policy zr_all_auth on z_reports for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shift_opens' and policyname = 'shifts_all_auth') then
    create policy shifts_all_auth on shift_opens for all to authenticated using (true) with check (true);
  end if;

  -- restock
  if not exists (select 1 from pg_policies where tablename = 'restock_requests' and policyname = 'restock_read_any') then
    create policy restock_read_any on restock_requests for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'restock_requests' and policyname = 'restock_write_auth') then
    create policy restock_write_auth on restock_requests for all to authenticated using (true) with check (true);
  end if;

  -- expenses
  if not exists (select 1 from pg_policies where tablename = 'expenses' and policyname = 'expenses_all_auth') then
    create policy expenses_all_auth on expenses for all to authenticated using (true) with check (true);
  end if;

  -- audit
  if not exists (select 1 from pg_policies where tablename = 'audit_log' and policyname = 'audit_read_auth') then
    create policy audit_read_auth on audit_log for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'audit_log' and policyname = 'audit_insert_auth') then
    create policy audit_insert_auth on audit_log for insert to authenticated with check (true);
  end if;
end $$;


-- ============================================================================
-- 11. REALTIME PUBLICATIONS
-- ============================================================================

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'menu_items', 'orders', 'order_items', 'payments',
    'shop_settings', 'print_jobs', 'restock_requests',
    'shift_opens', 'expenses'
  ]) loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
             when others then null;
    end;
  end loop;
end $$;


-- ============================================================================
-- 12. STORAGE — menu-photos + expense-receipts buckets + policies
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('menu-photos',       'menu-photos',       true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('expense-receipts',  'expense-receipts',  true, 8388608,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'menu_photos_read_any') then
    create policy menu_photos_read_any on storage.objects
      for select to anon, authenticated using (bucket_id = 'menu-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'menu_photos_insert_auth') then
    create policy menu_photos_insert_auth on storage.objects
      for insert to authenticated with check (bucket_id = 'menu-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'menu_photos_update_auth') then
    create policy menu_photos_update_auth on storage.objects
      for update to authenticated using (bucket_id = 'menu-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'menu_photos_delete_auth') then
    create policy menu_photos_delete_auth on storage.objects
      for delete to authenticated using (bucket_id = 'menu-photos');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'receipts_read_auth') then
    create policy receipts_read_auth on storage.objects
      for select to anon, authenticated using (bucket_id = 'expense-receipts');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'receipts_insert_auth') then
    create policy receipts_insert_auth on storage.objects
      for insert to authenticated with check (bucket_id = 'expense-receipts');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'receipts_delete_auth') then
    create policy receipts_delete_auth on storage.objects
      for delete to authenticated using (bucket_id = 'expense-receipts');
  end if;
end $$;


-- ============================================================================
-- 13. SEED DEFAULTS (only fills empties, won't overwrite your data)
-- ============================================================================

update shop_settings
   set shop_name      = coalesce(nullif(shop_name, ''),    'FuHao Dim Sum'),
       shop_name_zh   = coalesce(nullif(shop_name_zh, ''), '福豪點心'),
       sst_pct        = coalesce(nullif(sst_pct, 0),       6),
       round_to_5_sen = true
 where id = 1;


-- ============================================================================
-- 14. RELOAD POSTGREST SCHEMA CACHE
-- ============================================================================

notify pgrst, 'reload schema';


-- ============================================================================
-- DONE.
--
-- After running this:
--   1. Hard refresh your POS tab (⌘⇧R / close and reopen).
--   2. Redeploy Vercel if the build was cut before you added columns.
--   3. Go to Admin → Menu and upload photos on each item.
--   4. Go to Admin → Staff and set roles: cashier / supervisor / owner.
-- ============================================================================
