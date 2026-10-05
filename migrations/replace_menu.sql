-- ============================================================================
--  FUHAO POS — replace the whole menu with the new printed menu
--
--  Does everything in one go:
--    1. allow all three printer stations on menu_items (kitchen/cashier/bar)
--    2. add the price_cold column (drinks hot vs cold pricing)
--    3. wipe the old menu  (past orders keep their name/price snapshots; only
--       the link to the deleted menu row is cleared so the delete can proceed)
--    4. insert the new menu
--
--  Images are left empty (image_url NULL) — add them later in Admin → Menu.
--
--  Run once in Supabase → SQL Editor.  Safe to re-run (it re-wipes & re-inserts).
--
--  Category → printer station:
--    Dim Sum, Buns          → FRONT KITCHEN (cashier)
--    Noodles, Fried, Rice   → BACK KITCHEN  (kitchen)
--    Drinks                 → BAR           (bar)
-- ============================================================================

-- 1. widen the station check constraint
alter table menu_items drop constraint if exists menu_items_station_check;
alter table menu_items add constraint menu_items_station_check
  check (station in ('kitchen', 'cashier', 'bar'));

-- 2. cold price for drinks
alter table menu_items add column if not exists price_cold numeric(10,2);

-- 3. wipe the old menu (keep order history intact via its snapshots)
update order_items set menu_item_id = null;
delete from menu_items;

-- 4. insert the new menu
insert into menu_items
  (name_en, name_zh, price, price_cold, category, station, options_available, is_available, temporarily_disabled)
values
  -- ── Buns 包点 → front kitchen ──────────────────────────────────────────
  ('Butter Bun',                       '奶油包',       2.50, null, 'Buns',    'cashier', '[]', true, false),
  ('Pandan Bun',                       '班兰包',       2.50, null, 'Buns',    'cashier', '[]', true, false),
  ('Kaya Bun',                         '咖央包',       2.50, null, 'Buns',    'cashier', '[]', true, false),
  ('Red Bean Bun',                     '豆沙包',       2.50, null, 'Buns',    'cashier', '[]', true, false),
  ('Salted Egg Custard Bun (Set of 3)','流沙包 (3粒)', 5.00, null, 'Buns',    'cashier', '[]', true, false),
  ('Char Siew Bao',                    '叉烧包',       2.70, null, 'Buns',    'cashier', '[]', true, false),
  ('Meat Bun',                         '肉包',         2.70, null, 'Buns',    'cashier', '[]', true, false),
  ('Big Bun',                          '大包',         6.50, null, 'Buns',    'cashier', '[]', true, false),

  -- ── Dim Sum 点心 → front kitchen ───────────────────────────────────────
  ('Chee Cheong Fun', '猪肠粉', 6.50, null, 'Dim Sum', 'cashier',
     '[{"label":"Prawn","label_zh":"虾肉"},{"label":"Char Siew","label_zh":"叉烧"},{"label":"Prawn & Char Siew","label_zh":"虾+叉烧"}]', true, false),
  ('Lotus Leaf Glutinous Rice', '糯米鸡', 4.90, null, 'Dim Sum', 'cashier', '[]', true, false),

  -- ── Noodles 面类 → back kitchen ────────────────────────────────────────
  ('Hokkien Fried Noodles', '福建炒面', 8.00, null, 'Noodles', 'kitchen', '[]', true, false),
  ('Plain Noodles',         '白面',     8.00, null, 'Noodles', 'kitchen', '[]', true, false),
  ('Yuan Yang',             '鸳鸯',     8.00, null, 'Noodles', 'kitchen',
     '[{"label":"Dry Fried","label_zh":"干炒"},{"label":"Braised","label_zh":"焖"},{"label":"Soft Egg","label_zh":"滑蛋"}]', true, false),
  ('Hor Fun',               '河粉',     8.00, null, 'Noodles', 'kitchen',
     '[{"label":"Dry Fried","label_zh":"干炒"},{"label":"Braised","label_zh":"焖"},{"label":"Soft Egg","label_zh":"滑蛋"}]', true, false),
  ('Silver Needle Noodles', '老鼠粉',   8.00, null, 'Noodles', 'kitchen',
     '[{"label":"Dry Fried","label_zh":"干炒"},{"label":"Braised","label_zh":"焖"},{"label":"Soft Egg","label_zh":"滑蛋"}]', true, false),
  ('Bee Hoon',              '米粉',     8.00, null, 'Noodles', 'kitchen',
     '[{"label":"Dry Fried","label_zh":"干炒"},{"label":"Braised","label_zh":"焖"},{"label":"Soft Egg","label_zh":"滑蛋"}]', true, false),
  ('Yee Mee',               '伊面',     8.00, null, 'Noodles', 'kitchen',
     '[{"label":"Dry Fried","label_zh":"干炒"},{"label":"Braised","label_zh":"焖"},{"label":"Soft Egg","label_zh":"滑蛋"}]', true, false),
  ('Wonton Noodles',        '云吞面',   8.00, null, 'Noodles', 'kitchen',
     '[{"label":"Dry Fried","label_zh":"干炒"},{"label":"Braised","label_zh":"焖"},{"label":"Soft Egg","label_zh":"滑蛋"}]', true, false),
  ('Seafood Noodles',       '海鲜面',   8.00, null, 'Noodles', 'kitchen', '[]', true, false),
  ('Fried Kuih Kak',        '炒粿角',   7.00, null, 'Noodles', 'kitchen', '[]', true, false),

  -- ── Rice / Congee 饭/粥 → back kitchen ─────────────────────────────────
  ('Century Egg Congee', '皮蛋粥', 4.00, null, 'Rice', 'kitchen', '[]', true, false),

  -- ── Fried 油炸 → back kitchen ──────────────────────────────────────────
  ('Prawn Roll (Set of 3)',        '虾卷 (3条)',   6.00, null, 'Fried', 'kitchen', '[]', true, false),
  ('Fried Radish Cake (Set of 3)', '萝卜糕 (3片)', 4.50, null, 'Fried', 'kitchen', '[]', true, false),
  ('Century Egg Roll (Set of 2)',  '皮蛋卷 (2条)', 6.00, null, 'Fried', 'kitchen', '[]', true, false),
  ('Sesame Ball (Set of 3)',       '芝麻枣 (3粒)', 4.50, null, 'Fried', 'kitchen', '[]', true, false),
  ('Yam Puff (Set of 2)',          '芋角 (2粒)',   6.00, null, 'Fried', 'kitchen', '[]', true, false),
  ('Prawn Puff (Set of 3)',        '虾角 (3粒)',   6.00, null, 'Fried', 'kitchen', '[]', true, false),

  -- ── Drinks 饮料 → bar  (price = HOT, price_cold = COLD) ────────────────
  ('Kopi',             '咖啡',   2.00, 2.50, 'Drinks', 'bar', '[{"label":"Kosong","label_zh":"无糖"}]', true, false),
  ('Kopi O',           '咖啡乌', 1.60, 1.90, 'Drinks', 'bar', '[{"label":"Kosong","label_zh":"无糖"}]', true, false),
  ('Kopi C',           '咖啡C',  2.00, 2.50, 'Drinks', 'bar', '[{"label":"Kosong","label_zh":"无糖"}]', true, false),
  ('Teh',              '茶',     2.00, 2.30, 'Drinks', 'bar', '[{"label":"Kosong","label_zh":"无糖"}]', true, false),
  ('Teh O',            '茶乌',   1.60, 1.90, 'Drinks', 'bar', '[{"label":"Kosong","label_zh":"无糖"}]', true, false),
  ('Teh C',            '茶C',    2.00, 2.30, 'Drinks', 'bar', '[{"label":"Kosong","label_zh":"无糖"}]', true, false),
  ('Nescafe',          null,     2.80, 3.00, 'Drinks', 'bar', '[]', true, false),
  ('Nescafe O',        null,     2.30, 2.60, 'Drinks', 'bar', '[]', true, false),
  ('Nescafe O Kosong', null,     2.30, 2.60, 'Drinks', 'bar', '[]', true, false),
  ('Neslo',            null,     3.00, 3.20, 'Drinks', 'bar', '[]', true, false),
  ('White Coffee',     '白咖啡', 2.80, 3.00, 'Drinks', 'bar', '[]', true, false),
  ('Cham',             '咖啡茶', 2.50, 2.80, 'Drinks', 'bar', '[]', true, false),
  ('Tiger Bites Lion', '虎咬狮', 3.00, 3.30, 'Drinks', 'bar', '[]', true, false),
  ('Milo',             '美禄',   2.80, 3.00, 'Drinks', 'bar', '[{"label":"Kosong","label_zh":"无糖"}]', true, false),
  ('Eight Treasure Tea','八宝',  2.00, 2.00, 'Drinks', 'bar', '[]', true, false),
  ('Chrysanthemum Tea','菊花',   2.00, 2.00, 'Drinks', 'bar', '[]', true, false),
  ('Herbal Tea',       '凉茶',   2.00, 2.00, 'Drinks', 'bar', '[]', true, false),
  ('Chinese Tea',      '唐茶',   0.80, 0.80, 'Drinks', 'bar', '[]', true, false),
  ('Plain Water',      '白开水', 0.50, 0.50, 'Drinks', 'bar', '[]', true, false),
  ('Canned Soft Drink','罐装汽水',2.80, null, 'Drinks', 'bar', '[]', true, false);

notify pgrst, 'reload schema';

-- ============================================================================
--  DONE.  47 items inserted.  Hard-refresh the POS (Cmd/Ctrl+Shift+R).
-- ============================================================================
