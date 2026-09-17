-- ============================================================================
-- FuHao Dim Sum POS — DEMO SEED
--
-- Adds enough fake data to test every dashboard, report, ranking and audit
-- feature.  Every demo row is tagged with `[DEMO]` in its note/description
-- so you can find and remove them later with:
--
--   delete from expenses  where description like '[DEMO]%' or note like '[DEMO]%';
--   delete from orders    where discount_reason like '[DEMO]%' or void_reason like '[DEMO]%';
--   delete from audit_log where reason like '[DEMO]%';
--
-- Safe to run on a fresh project — will not duplicate menu items on repeat
-- runs (uses "insert … where not exists" on unique names).
--
-- Run in Supabase → SQL Editor → New query → paste → Run.
-- Run 000_setup_all.sql FIRST — this seed assumes the schema is ready.
-- ============================================================================


-- ============================================================================
-- 1. MENU ITEMS — 33 dishes across the 7 categories from the client spec.
-- ============================================================================

insert into menu_items (name_en, name_zh, price, category, station, sort_order, is_available)
select v.name_en, v.name_zh, v.price, v.category, v.station, v.sort, true
from (values
  -- 點心 Dim Sum ------------------------------------------------------------
  ('Siu Mai',           '燒賣',        7.80, 'Dim Sum', 'kitchen',  10),
  ('Har Gow',           '蝦餃',        8.80, 'Dim Sum', 'kitchen',  20),
  ('Chicken Feet',      '鳳爪',        7.80, 'Dim Sum', 'kitchen',  30),
  ('Spare Ribs',        '排骨',        8.50, 'Dim Sum', 'kitchen',  40),
  ('Turnip Cake',       '蘿蔔糕',      7.20, 'Dim Sum', 'kitchen',  50),
  ('Spring Roll',       '春卷',        6.80, 'Dim Sum', 'kitchen',  60),
  ('Lotus Leaf Rice',   '糯米雞',      9.50, 'Dim Sum', 'kitchen',  70),
  ('Fried Dumpling',    '鹹水角',      6.80, 'Dim Sum', 'kitchen',  80),
  -- 包點 Buns ---------------------------------------------------------------
  ('Char Siu Bao',      '叉燒包',      6.80, 'Buns',    'kitchen',  10),
  ('Meat Bun',          '肉包',        5.80, 'Buns',    'kitchen',  20),
  ('Chicken Bun',       '雞肉包',      5.80, 'Buns',    'kitchen',  30),
  ('Lotus Paste Bun',   '蓮蓉包',      5.20, 'Buns',    'kitchen',  40),
  ('Custard Bun',       '奶皇包',      6.20, 'Buns',    'kitchen',  50),
  -- 飯類 Rice ---------------------------------------------------------------
  ('Fried Rice',        '炒飯',       12.80, 'Rice',    'kitchen',  10),
  ('Chicken Rice',      '雞飯',       11.80, 'Rice',    'kitchen',  20),
  ('Yang Chow Rice',    '揚州炒飯',   13.80, 'Rice',    'kitchen',  30),
  ('Salted Fish Rice',  '鹹魚雞粒炒飯', 14.80, 'Rice',  'kitchen',  40),
  -- 面/炒類 Noodles ----------------------------------------------------------
  ('Fried Noodles',     '炒麵',       12.50, 'Noodles', 'kitchen',  10),
  ('Char Kway Teow',    '炒粿條',     13.50, 'Noodles', 'kitchen',  20),
  ('Noodle Soup',       '湯麵',       11.50, 'Noodles', 'kitchen',  30),
  ('Wonton Noodles',    '雲吞麵',     12.80, 'Noodles', 'kitchen',  40),
  ('Dry Noodles',       '乾撈麵',     11.80, 'Noodles', 'kitchen',  50),
  -- 飲料 Drinks -------------------------------------------------------------
  ('Chinese Tea',       '中國茶',      2.50, 'Drinks',  'bar',      10),
  ('Coffee',            '咖啡',        3.50, 'Drinks',  'bar',      20),
  ('Milk Tea',          '奶茶',        4.50, 'Drinks',  'bar',      30),
  ('Soy Milk',          '豆漿',        3.20, 'Drinks',  'bar',      40),
  ('Chrysanthemum Tea', '菊花茶',      3.50, 'Drinks',  'bar',      50),
  -- 燒味 Roasted -----------------------------------------------------------
  ('Char Siu',          '叉燒',       18.80, 'Roasted', 'kitchen',  10),
  ('Roast Pork',        '燒肉',       19.80, 'Roasted', 'kitchen',  20),
  ('Roast Chicken',     '燒雞',       22.80, 'Roasted', 'kitchen',  30),
  ('Roast Duck',        '燒鴨',       28.80, 'Roasted', 'kitchen',  40),
  -- 其他 Other -------------------------------------------------------------
  ('Mango Pudding',     '芒果布丁',    5.80, 'Other',   'kitchen',  10),
  ('Tong Sui',          '糖水',        4.50, 'Other',   'kitchen',  20)
) as v(name_en, name_zh, price, category, station, sort)
where not exists (
  select 1 from menu_items m where m.name_en = v.name_en
);

-- Add some suggested modifiers to a few items so the modifier UI has data.
update menu_items set options_available = '[
  {"label": "No shrimp",   "label_zh": "不蝦"},
  {"label": "Extra sauce", "label_zh": "多醬"}
]'::jsonb where name_en in ('Siu Mai', 'Har Gow') and options_available = '[]'::jsonb;

update menu_items set options_available = '[
  {"label": "Less sugar",  "label_zh": "少糖"},
  {"label": "No ice",      "label_zh": "不加冰"},
  {"label": "Hot",         "label_zh": "熱"}
]'::jsonb where category = 'Drinks' and options_available = '[]'::jsonb;

update menu_items set options_available = '[
  {"label": "Extra chilli", "label_zh": "多辣"},
  {"label": "Less oil",     "label_zh": "少油"},
  {"label": "No coriander", "label_zh": "不香菜"}
]'::jsonb where category in ('Rice', 'Noodles') and options_available = '[]'::jsonb;


-- ============================================================================
-- 2. STAFF — an owner, a supervisor, two cashiers.
--   IMPORTANT: this only creates the staff *rows*.  To let them actually sign
--   in, create matching auth users in Supabase → Authentication → Users, then
--   go to Admin → Staff and edit each row to attach a user account.
-- ============================================================================

insert into staff (name, pin, role, monthly_salary, active)
select v.name, v.pin, v.role, v.salary, true
from (values
  ('Ah Kong (Owner)',       '9999', 'owner',      3500),
  ('Uncle Wong (Sup)',      '5555', 'supervisor', 2800),
  ('Mei Ling',              '1111', 'cashier',    2200),
  ('Sarah',                 '2222', 'cashier',    2200)
) as v(name, pin, role, salary)
where not exists (select 1 from staff s where s.pin = v.pin);


-- ============================================================================
-- 3. ORDERS — 30 days of activity so charts and reports have shape.
--   Each day gets 8-18 orders.  Payment methods are a realistic mix.
--   Some orders get discounted, some get voided, one gets refunded.
-- ============================================================================

do $$
declare
  d               date;
  order_count     int;
  order_id_new    bigint;
  n_items         int;
  total_amt       numeric(10,2);
  paid_time       timestamptz;
  method          text;
  cur_menu        record;
  menu_ids        bigint[];
  menu_prices     numeric(10,2)[];
  menu_names      text[];
  menu_names_zh   text[];
  menu_stations   text[];
  chosen_idx      int;
  i               int;
  j               int;
  qty             int;
  price           numeric(10,2);
  subtotal        numeric(10,2);
  discount_amt    numeric(10,2);
  table_no        int;
  rand_val        numeric;
  seed_marker     text := '[DEMO]';
begin
  -- Grab every menu item once so the loop doesn't re-query.
  select array_agg(id order by id),
         array_agg(price order by id),
         array_agg(name_en order by id),
         array_agg(name_zh order by id),
         array_agg(station order by id)
    into menu_ids, menu_prices, menu_names, menu_names_zh, menu_stations
    from menu_items
   where is_available = true;

  if menu_ids is null or array_length(menu_ids, 1) = 0 then
    raise notice 'No menu items found — run section 1 first';
    return;
  end if;

  -- Loop 30 days back from today.
  for d in select (current_date - i)::date
             from generate_series(0, 29) as i
  loop
    order_count := 8 + floor(random() * 11)::int;  -- 8-18 orders per day

    for j in 1..order_count loop
      -- 1-6 line items in each order
      n_items := 1 + floor(random() * 6)::int;
      subtotal := 0;
      table_no := 1 + floor(random() * 25)::int;

      -- Random peak-hour distribution: 10am-2pm for lunch, 5-8pm for dinner.
      -- Pick a random hour biased toward those windows.
      rand_val := random();
      paid_time := d::timestamptz + (
        case
          when rand_val < 0.55 then interval '10 hours' + (random() * interval '4 hours')  -- lunch
          when rand_val < 0.90 then interval '17 hours' + (random() * interval '3 hours')  -- dinner
          else                       interval '15 hours' + (random() * interval '2 hours')  -- afternoon
        end
      );

      -- Method distribution: cash 40%, DuitNow 40%, card 15%, other 5%.
      rand_val := random();
      method := case
        when rand_val < 0.40 then 'cash'
        when rand_val < 0.80 then 'duitnow_qr'
        when rand_val < 0.95 then 'card'
        else 'bank_transfer'
      end;

      -- Create the order row (subtotal / total will be updated after items).
      insert into orders (
        table_number, status, subtotal, service_charge, tax, rounding,
        discount, discount_reason, total, payment_method, paid_at, created_at
      ) values (
        table_no, 'paid', 0, 0, 0, 0, 0, null, 0, method, paid_time, paid_time
      )
      returning id into order_id_new;

      -- Add line items.
      for i in 1..n_items loop
        chosen_idx := 1 + floor(random() * array_length(menu_ids, 1))::int;
        qty        := 1 + floor(random() * 3)::int;
        price      := menu_prices[chosen_idx];
        subtotal   := subtotal + (price * qty);

        insert into order_items (
          order_id, menu_item_id, name_snapshot, name_zh_snapshot,
          price_at_time, qty, kitchen_status, created_at
        ) values (
          order_id_new,
          menu_ids[chosen_idx],
          menu_names[chosen_idx],
          menu_names_zh[chosen_idx],
          price,
          qty,
          'ready',
          paid_time
        );
      end loop;

      -- One in ten orders gets a discount.
      discount_amt := 0;
      if random() < 0.10 then
        discount_amt := round((subtotal * 0.10)::numeric, 2);  -- 10% off
        update orders
           set discount = discount_amt,
               discount_reason = seed_marker || ' Regular customer 10%'
         where id = order_id_new;
      end if;

      total_amt := subtotal - discount_amt;

      update orders
         set subtotal = subtotal, total = total_amt
       where id = order_id_new;

      -- Payment row
      insert into payments (order_id, method, amount, status, created_at)
      values (order_id_new, method, total_amt, 'succeeded', paid_time);
    end loop;
  end loop;

  raise notice 'Seeded 30 days of orders across % menu items', array_length(menu_ids, 1);
end $$;


-- ============================================================================
-- 4. VOIDED and REFUNDED orders — a couple so the audit-log has entries.
-- ============================================================================

do $$
declare
  voided_id   bigint;
  refunded_id bigint;
  seed        text := '[DEMO]';
begin
  -- Void the newest 2 orders from 3 days ago
  update orders
     set status      = 'void',
         voided_at   = current_timestamp - interval '3 days',
         voided_by   = 'demo-supervisor@fuhao',
         void_reason = seed || ' Customer changed mind'
   where id in (
     select id from orders
      where paid_at::date = current_date - 3
      order by id desc
      limit 2
   )
   returning id into voided_id;

  -- Refund the newest order from 7 days ago
  update orders
     set status        = 'refunded',
         refunded_at   = current_timestamp - interval '7 days',
         refunded_by   = 'demo-owner@fuhao',
         refund_reason = seed || ' Wrong order, refunded in cash'
   where id in (
     select id from orders where paid_at::date = current_date - 7 order by id desc limit 1
   )
   returning id into refunded_id;
end $$;


-- ============================================================================
-- 5. EXPENSES — 30 days worth: purchases every day, wages every workday,
--    staff meals, weekly other expenses, monthly rent and utility bills.
-- ============================================================================

do $$
declare
  d          date;
  seed       text := '[DEMO]';
  amt        numeric(10,2);
begin
  for d in select (current_date - i)::date from generate_series(0, 29) as i
  loop
    -- ---- Daily purchase (usually one, sometimes two) --------------------
    amt := 600 + (random() * 700)::numeric(10,2);
    insert into expenses (
      kind, business_date, amount, payment_method, description, supplier,
      note, created_by, created_at
    ) values (
      'purchase', d, amt::numeric(10,2), 'cash',
      seed || ' Meat + Seafood', 'Uncle Lim (Market)',
      seed || ' auto-seeded', 'demo-owner@fuhao',
      d::timestamptz + interval '7 hours'
    );

    if random() < 0.5 then
      amt := 100 + (random() * 200)::numeric(10,2);
      insert into expenses (
        kind, business_date, amount, payment_method, description, supplier,
        note, created_by, created_at
      ) values (
        'purchase', d, amt::numeric(10,2), 'duitnow_qr',
        seed || ' Vegetables', 'Ah Choo Vege',
        seed || ' auto-seeded', 'demo-owner@fuhao',
        d::timestamptz + interval '7 hours 30 minutes'
      );
    end if;

    -- ---- Daily wages (2 daily-paid staff each day) ----------------------
    insert into expenses (
      kind, business_date, amount, payment_method, staff_name,
      hours, normal_wage, ot_amount, note, created_by, created_at
    ) values (
      'wages', d, 80.00, 'cash', 'Ah Hock (Cook)',
      8, 80, 0, seed || ' auto-seeded', 'demo-owner@fuhao',
      d::timestamptz + interval '21 hours'
    ),
    (
      'wages', d, 75.00, 'cash', 'Ah Fatt (Kitchen Help)',
      8, 75, 0, seed || ' auto-seeded', 'demo-owner@fuhao',
      d::timestamptz + interval '21 hours 5 minutes'
    );

    -- ---- Staff meal ------------------------------------------------------
    insert into expenses (
      kind, business_date, amount, payment_method, description,
      note, created_by, created_at
    ) values (
      'meal', d, 60 + (random() * 30)::numeric(10,2), 'cash',
      seed || ' 6 staff meals', seed || ' auto-seeded', 'demo-owner@fuhao',
      d::timestamptz + interval '13 hours'
    );

    -- ---- Weekly other expenses (every 7 days) ---------------------------
    if extract(dow from d) = 0 then  -- Sundays
      insert into expenses (
        kind, business_date, amount, payment_method, description,
        note, created_by, created_at
      ) values (
        'other', d, 40 + (random() * 40)::numeric(10,2), 'cash',
        seed || ' Cleaning supplies & packaging', seed || ' auto-seeded',
        'demo-owner@fuhao', d::timestamptz + interval '11 hours'
      );
    end if;
  end loop;

  -- ---- Monthly rent (paid on the 1st of the current month, if we've passed it)
  if extract(day from current_date) >= 1 then
    insert into expenses (
      kind, business_date, amount, payment_method, description,
      note, created_by, created_at
    )
    select 'rent', date_trunc('month', current_date)::date, 3500.00, 'bank_transfer',
           seed || ' Shop rent — ' || to_char(current_date, 'FMMonth YYYY'),
           seed || ' auto-seeded', 'demo-owner@fuhao',
           date_trunc('month', current_date)::timestamptz + interval '9 hours'
    where not exists (
      select 1 from expenses
       where kind = 'rent'
         and business_date = date_trunc('month', current_date)::date
         and description like seed || '%'
    );
  end if;

  -- ---- Monthly utility (mid-month TNB bill)
  insert into expenses (
    kind, business_date, amount, payment_method, description,
    note, created_by, created_at
  )
  select 'utility', (date_trunc('month', current_date) + interval '14 days')::date,
         480 + (random() * 120)::numeric(10,2), 'card',
         seed || ' TNB electricity bill', seed || ' auto-seeded', 'demo-owner@fuhao',
         (date_trunc('month', current_date) + interval '14 days')::timestamptz + interval '10 hours'
  where (date_trunc('month', current_date) + interval '14 days')::date <= current_date
    and not exists (
      select 1 from expenses
       where kind = 'utility'
         and business_date = (date_trunc('month', current_date) + interval '14 days')::date
         and description like seed || '%'
    );
end $$;


-- ============================================================================
-- 6. AUDIT LOG — a handful of demo entries so the log page has content.
-- ============================================================================

insert into audit_log (actor_email, actor_role, action, target_type, target_id,
                       amount, reason, created_at)
select v.email, v.role, v.action, v.target_type, v.target_id, v.amount,
       '[DEMO] ' || v.reason,
       current_timestamp - (v.days_ago || ' days')::interval
from (values
  ('demo-supervisor@fuhao', 'supervisor', 'void',     'order',     1001::bigint, 42.60::numeric, 'Customer changed mind',    3),
  ('demo-supervisor@fuhao', 'supervisor', 'discount', 'order',     1005::bigint, 3.80::numeric,  'Regular customer 10%',     2),
  ('demo-owner@fuhao',      'owner',      'refund',   'order',     1010::bigint, 28.00::numeric, 'Wrong order, refunded',    7),
  ('demo-owner@fuhao',      'owner',      'price_change', 'menu_item', 1::bigint, null::numeric, 'Char Siu Bao: 6.50 → 6.80', 5),
  ('demo-owner@fuhao',      'owner',      'menu_item_delete', 'menu_item', 999::bigint, null::numeric, 'Removed old item',   14)
) as v(email, role, action, target_type, target_id, amount, reason, days_ago);


-- ============================================================================
-- 7. RESTOCK REQUESTS — a couple of open requests so /restock has content.
-- ============================================================================

insert into restock_requests (menu_item_id, item_name_snapshot, item_name_zh_snapshot,
                              qty_wanted, note, requested_at, requested_by)
select m.id, m.name_en, m.name_zh, 2, '[DEMO] Front tray almost empty',
       current_timestamp - interval '30 minutes', 'demo-cashier@fuhao'
  from menu_items m
 where m.name_en in ('Char Siu Bao', 'Har Gow', 'Siu Mai')
   and not exists (
     select 1 from restock_requests r
      where r.menu_item_id = m.id
        and r.fulfilled_at is null
   );


-- ============================================================================
-- 8. RELOAD POSTGREST SCHEMA CACHE
-- ============================================================================

notify pgrst, 'reload schema';


-- ============================================================================
-- SUMMARY
--
-- After this runs, click through:
--
--   /            → POS terminal (33 items across 7 categories)
--   /kitchen     → live kitchen display
--   /bar         → live bar display
--   /restock     → 3 pending restock cards
--   /cashier     → any open orders (none by default — go to POS to make some)
--   /admin       → dashboard tiles will populate
--   /admin/menu  → 33 items, some with modifiers
--   /admin/staff → 4 staff rows (Ah Kong · Uncle Wong · Mei Ling · Sarah)
--   /admin/expenses       → 30 days of purchases, wages, meals, rent, utility
--   /admin/monthly-report → this month's P&L
--   /admin/rankings       → best-sellers ranked
--   /admin/audit-log      → 5 demo audit entries + any voids/refunds/discounts
--
-- To wipe all demo rows later:
--
--   delete from expenses  where note like '[DEMO]%' or description like '[DEMO]%';
--   delete from audit_log where reason like '[DEMO]%';
--   delete from restock_requests where note like '[DEMO]%';
--   delete from orders    where discount_reason like '[DEMO]%' or void_reason like '[DEMO]%' or refund_reason like '[DEMO]%';
--   -- If you also want to remove non-marked demo orders (all seeded orders):
--   -- WARNING: this deletes every order in the DB.
--   -- truncate order_items, payments, orders restart identity cascade;
--
-- Menu items and staff are safe to keep — edit or delete individual rows
-- from the Admin pages.
-- ============================================================================
