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
  price: number;
  image_url: string | null;
  options_available: ItemModifier[];
  category: string;
  is_available: boolean;             // owner-controlled: is this on the menu at all
  temporarily_disabled: boolean;     // sold-out / paused for today only
  sort_order: number;
  station: PrintStation;
};

// Where a print job lands. Kitchen and bar are prep stations;
// cashier is the counter printer for receipts and refunds.
export type PrintStation = 'kitchen' | 'bar' | 'cashier';

export const STATIONS: {
  key: PrintStation;
  label: string;
  label_zh: string;
  emoji: string;
}[] = [
  { key: 'kitchen', label: 'Kitchen',           label_zh: '廚房', emoji: '👨‍🍳' },
  { key: 'bar',     label: 'Bar / Drinks',      label_zh: '水吧', emoji: '🫖' },
  { key: 'cashier', label: 'Counter (Cashier)', label_zh: '收銀', emoji: '💰' },
];

// The seven menu categories per the client's spec.  Chinese labels stay
// visible alongside the English so cooks and cashiers see both.
export const MENU_CATEGORIES: { key: string; label: string; label_zh: string; emoji: string }[] = [
  { key: 'Dim Sum',   label: 'Dim Sum',        label_zh: '點心', emoji: '🥟' },
  { key: 'Buns',      label: 'Buns',           label_zh: '包點', emoji: '🫓' },
  { key: 'Rice',      label: 'Rice',           label_zh: '飯類', emoji: '🍚' },
  { key: 'Noodles',   label: 'Noodles / Fried',label_zh: '面 / 炒類', emoji: '🍜' },
  { key: 'Drinks',    label: 'Drinks',         label_zh: '飲料', emoji: '🫖' },
  { key: 'Roasted',   label: 'Roasted Meats',  label_zh: '燒味', emoji: '🍖' },
  { key: 'Other',     label: 'Other',          label_zh: '其他', emoji: '🍽️' },
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

// Suggested starter modifiers shown as one-tap "add" chips in the admin
// menu editor. They are just suggestions — the waiter only ever sees
// the modifiers that were actually saved on each menu item.
export const SUGGESTED_MODIFIERS: ItemModifier[] = [
  { label: 'No pork',          label_zh: '不豬肉' },
  { label: 'No shrimp',        label_zh: '不蝦' },
  { label: 'No peanut',        label_zh: '不花生' },
  { label: 'No coriander',     label_zh: '不香菜' },
  { label: 'No spring onion',  label_zh: '不蔥' },
  { label: 'Less oil',         label_zh: '少油' },
  { label: 'Less salt',        label_zh: '少鹽' },
  { label: 'Extra sauce',      label_zh: '多醬' },
  { label: 'Extra chilli',     label_zh: '多辣' },
  { label: 'No chilli',        label_zh: '不辣' },
  { label: 'Well done',        label_zh: '熟透' },
  { label: 'Hot water',        label_zh: '熱水' },
  { label: 'No ice',           label_zh: '不加冰' },
  { label: 'Less sugar',       label_zh: '少糖' },
  { label: 'Extra sugar',      label_zh: '多糖' },
  { label: 'Half portion',     label_zh: '半份' },
];

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
  updated_at: string;
};

export type PayMethod = 'cash' | 'duitnow_qr' | 'card' | 'bank_transfer' | 'other';

export const PAY_METHOD_LABELS: Record<PayMethod, { label: string; label_zh: string; emoji: string }> = {
  cash:          { label: 'Cash',          label_zh: '現金',    emoji: '💵' },
  duitnow_qr:    { label: 'TNG / DuitNow', label_zh: '電子錢包', emoji: '📱' },
  card:          { label: 'Card',          label_zh: '刷卡',    emoji: '💳' },
  bank_transfer: { label: 'Bank Transfer', label_zh: '銀行轉賬', emoji: '🏦' },
  other:         { label: 'Other',         label_zh: '其他',    emoji: '📝' },
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

export type PrintJobKind = 'kitchen' | 'receipt' | 'void' | 'refund' | 'restock';

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

export type PrintJob = {
  id: number;
  order_id: number | null;
  kind: PrintJobKind;
  station: PrintStation;
  payload: Record<string, unknown> | null;
  created_at: string;
  printed_at: string | null;
};

// -------------------------------------------------------------------------
// STAFF + PERMISSIONS
// -------------------------------------------------------------------------

// Two roles, stored in each Supabase user's user_metadata.
//   staff  → everything except /admin/*
//   admin  → everything
export type StaffRole = 'staff' | 'admin';

export const ROLE_LABELS: Record<StaffRole, { label: string; label_zh: string; emoji: string }> = {
  staff: { label: 'Staff', label_zh: '員工', emoji: '👤' },
  admin: { label: 'Admin', label_zh: '老闆', emoji: '👑' },
};

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

export const EXPENSE_LABELS: Record<ExpenseKind, { label: string; label_zh: string; emoji: string }> = {
  wages:    { label: 'Staff Wages',   label_zh: '員工工資', emoji: '💰' },
  meal:     { label: 'Staff Meal',    label_zh: '員工伙食', emoji: '🍱' },
  purchase: { label: 'Daily Purchase',label_zh: '當日採購', emoji: '🛒' },
  other:    { label: 'Other Expense', label_zh: '其他支出', emoji: '📝' },
  rent:     { label: 'Rent',          label_zh: '租金',    emoji: '🏢' },
  utility:  { label: 'Utility',       label_zh: '水電費',  emoji: '💡' },
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
