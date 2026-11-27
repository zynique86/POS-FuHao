// Shared DB row types — mirror the Supabase schema.
// Kept in one place so pages, services and the printer stay in sync.

// A per-item modifier chip the waiter can toggle when adding the item to a
// cart. Each menu item carries its own list, so "No pork" is on the har gow
// but not on tea, and "Less sugar" is on tea but not on har gow.
export type ItemModifier = {
  label: string;     // English
  label_zh: string;  // Chinese (may be empty)
};

export type MenuItem = {
  id: number;
  name_en: string;
  name_zh: string | null;
  price: number;                     // base price; for drinks this is the HOT price
  price_cold: number | null;         // drinks only: COLD price. null = no hot/cold choice
  image_url: string | null;
  options_available: ItemModifier[];
  category: string;
  is_available: boolean;             // owner-controlled: is this on the menu at all
  temporarily_disabled: boolean;     // sold-out / paused for today only
  station: PrintStation;
};

// Where a print job lands. Kitchen and bar are prep stations;
// cashier is the counter printer for receipts and refunds.
export type PrintStation = 'kitchen' | 'bar' | 'cashier';

// -------------------------------------------------------------------------
// CATEGORY → STATION ROUTING
// -------------------------------------------------------------------------
// Waiters pick from many menu categories (below) so items are easy to find.
// The back end collapses every category to just THREE printer stations, so the
// printer always knows exactly where to print:
//
//   'kitchen'  = BACK KITCHEN  (the wok)      → noodles, fried & rice
//   'cashier'  = FRONT KITCHEN (front counter)→ dim sum, buns, roasted, …
//   'bar'      = BAR                          → drinks
//
// (The station KEYS stay 'kitchen'/'cashier'/'bar' because each maps to a
//  printer IP in printer-service/.env — only the on-screen/printed LABELS say
//  "Back Kitchen" / "Front Kitchen" / "Bar".)
//
// The real source of truth is the category_station_routing table, which
// admins edit in Admin > Menu > "Categories & printers".  The table below is
// only the built-in fallback used before that loads (or if it can't load).
const CATEGORY_STATION: Record<string, PrintStation> = {
  // Back kitchen (wok)
  'noodles': 'kitchen',
  'noodles / fried': 'kitchen',
  'fried': 'kitchen',
  'rice': 'kitchen',
  // Bar
  'drinks': 'bar',
  // Front kitchen (front counter) — everything else
  'dim sum': 'cashier',
  'buns': 'cashier',
  'roasted': 'cashier',
  'other': 'cashier',
};

// Live routing loaded from the category_station_routing table (which admins
// edit in Admin > Menu > Categories & printers).  Filled by
// lib/categories.ts; until it loads, the built-in table above is used.
let liveCategoryStation: Record<string, PrintStation> | null = null;
export function setLiveCategoryStations(map: Record<string, PrintStation> | null) {
  liveCategoryStation = map;
}

export function stationForCategory(
  category: string | null | undefined
): PrintStation {
  // Normalise so stray casing / spacing can't misroute an item.
  const c = (category || '').trim().toLowerCase();
  // Unknown / uncategorised items default to the front counter
  // (same rule as send_order() in the database).
  if (liveCategoryStation) return liveCategoryStation[c] ?? 'cashier';
  return CATEGORY_STATION[c] ?? 'cashier';
}

// Built-in default category list (fallback only — the live list comes from
// the database via useMenuCategories() in lib/categories.ts).  Each one routes to one of the three printer stations via
// stationForCategory() above (shown in the comments).  Chinese labels stay
// visible alongside the English so everyone sees both.
export const MENU_CATEGORIES: { key: string; label: string; label_zh: string; emoji: string }[] = [
  { key: 'Dim Sum', label: 'Dim Sum',       label_zh: '點心', emoji: '🥟' }, // → front kitchen
  { key: 'Buns',    label: 'Buns',          label_zh: '包點', emoji: '🫓' }, // → front kitchen
  { key: 'Noodles', label: 'Noodles',       label_zh: '麵類', emoji: '🍜' }, // → back kitchen
  { key: 'Fried',   label: 'Fried',         label_zh: '油炸', emoji: '🍤' }, // → back kitchen
  { key: 'Rice',    label: 'Rice / Congee', label_zh: '飯 / 粥', emoji: '🍚' }, // → back kitchen
  { key: 'Roasted', label: 'Roasted Meats', label_zh: '燒味', emoji: '🍖' }, // → front kitchen
  { key: 'Drinks',  label: 'Drinks',        label_zh: '飲料', emoji: '🫖' }, // → bar
  { key: 'Other',   label: 'Other',         label_zh: '其他', emoji: '🍽️' }, // → front kitchen
];

export type OrderItem = {
  id: number;
  order_id: number;
  menu_item_id: number | null;
  name_snapshot: string;
  name_zh_snapshot: string | null;
  qty: number;
  price_at_time: number;
  options: string | null;   // comma-separated modifier chips
  note: string | null;      // free-text kitchen note
  kitchen_status: string;
  voided_at: string | null;
  void_reason: string | null;
  voided_by: string | null;
};

export type OrderStatus = 'open' | 'closed' | 'paid' | 'void' | 'refunded';

export type Order = {
  id: number;
  table_number: number;
  status: OrderStatus;
  subtotal: number;
  service_charge: number;
  tax: number;
  rounding: number;
  discount: number;             // flat RM amount subtracted from total
  discount_reason: string | null;
  total: number;
  created_at: string;
  paid_at: string | null;
  payment_method: string | null;
  voided_at: string | null;
  void_reason: string | null;
  voided_by: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  refunded_by: string | null;
  // Who sent the order from the POS.  Recorded at insert time so the
  // Kitchen, Bar and Cashier screens can show it.
  taken_by_email: string | null;
  taken_by_name: string | null;
};

export type ShopSettings = {
  id: 1;
  shop_name: string;
  shop_name_zh: string;
  address: string;
  sst_pct: number;
  service_charge_pct: number;
  round_to_5_sen: boolean;
  // Receipt header/footer details — printed by printer-service/index.js.
  // Blank means the line is left off the receipt.
  phone?: string | null;
  tax_id?: string | null;
  wifi_ssid?: string | null;
  wifi_password?: string | null;
  receipt_thank_you?: string | null;
  receipt_come_again?: string | null;
  // Public URL of the shop's static payment QR image (TNG eWallet / DuitNow
  // National QR), uploaded in Admin > Settings. Blank = none uploaded.
  payment_qr_url?: string | null;
  // Optional DuitNow merchant details — unset until the shop supplies them
  // in Admin > Settings. When any of these is missing the cashier screen
  // shows a decorative placeholder instead of generating an invalid QR.
  duitnow_merchant_id?: string | null;
  duitnow_merchant_name?: string | null;
  duitnow_merchant_city?: string | null;
  updated_at: string;
};

export type PayMethod = 'cash' | 'duitnow_qr' | 'card' | 'bank_transfer' | 'other';

export const PAY_METHOD_LABELS: Record<PayMethod, { label: string; emoji: string }> = {
  cash:          { label: 'Cash',          emoji: '💵' },
  duitnow_qr:    { label: 'TNG / DuitNow', emoji: '📱' },
  card:          { label: 'Card',          emoji: '💳' },
  bank_transfer: { label: 'Bank Transfer', emoji: '🏦' },
  other:         { label: 'Other',         emoji: '📝' },
};

export type Payment = {
  id: number;
  order_id: number;
  method: PayMethod;
  amount: number;
  received: number | null;
  change_given: number | null;
  status: string;
  created_at: string;
};

export type RestockRequest = {
  id: number;
  menu_item_id: number;
  item_name_snapshot: string;
  item_name_zh_snapshot: string | null;
  qty_wanted: number | null;
  note: string | null;
  requested_at: string;
  requested_by: string | null;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
};

// -------------------------------------------------------------------------
// ORDER ACTION LOG
// -------------------------------------------------------------------------
// Accountability trail for order-level actions any staff member can take:
// removing a whole order, or moving it to a different table.  Each row
// records who did it and why.
export type OrderLogAction = 'remove_order' | 'change_table' | 'remove_item';

export type OrderLog = {
  id: number;
  order_id: number | null;
  table_number: number | null;
  action: OrderLogAction;
  reason: string;
  actor_email: string | null;
  actor_name: string | null;
  details: Record<string, unknown> | null;  // e.g. { from_table, to_table }
  created_at: string;
};

// -------------------------------------------------------------------------
// STAFF + PERMISSIONS
// -------------------------------------------------------------------------

// Two roles, stored in each Supabase user's user_metadata.
//   staff  → everything except /admin/*
//   admin  → everything
export type StaffRole = 'staff' | 'admin';

// -------------------------------------------------------------------------
// EXPENSES
// -------------------------------------------------------------------------

// Six kinds cover everything the client's spec asked for.  A row records the
// actual cash going out, no attempt to attribute it to a specific dish.
export type ExpenseKind =
  | 'wages'
  | 'meal'
  | 'purchase'
  | 'other'
  | 'rent'
  | 'utility';

export const EXPENSE_LABELS: Record<ExpenseKind, { label: string; emoji: string }> = {
  wages:    { label: 'Staff Wages',   emoji: '💰' },
  meal:     { label: 'Staff Meal',    emoji: '🍱' },
  purchase: { label: 'Daily Purchase',emoji: '🛒' },
  other:    { label: 'Other Expense', emoji: '📝' },
  rent:     { label: 'Rent',          emoji: '🏢' },
  utility:  { label: 'Utility',       emoji: '💡' },
};

export type Expense = {
  id: number;
  kind: ExpenseKind;
  business_date: string;    // YYYY-MM-DD
  amount: number;
  payment_method: PayMethod | null;
  description: string | null;
  supplier: string | null;
  receipt_url: string | null;
  // Wages-specific — just a name snapshot, no FK
  staff_name: string | null;
  hours: number | null;
  normal_wage: number | null;
  ot_amount: number | null;
  other_amount: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};
