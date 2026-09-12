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
  is_available: boolean;
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
  { key: 'kitchen', label: 'Kitchen', label_zh: '廚房', emoji: '👨‍🍳' },
  { key: 'bar',     label: 'Bar / Drinks', label_zh: '水吧', emoji: '🫖' },
  { key: 'cashier', label: 'Counter (Cashier)', label_zh: '收銀', emoji: '💰' },
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

export type PayMethod = 'cash' | 'duitnow_qr' | 'card';

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
