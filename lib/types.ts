// Shared DB row types — mirror the Supabase schema.
// Kept in one place so pages, services and the printer stay in sync.

export type MenuItem = {
  id: number;
  name_en: string;
  name_zh: string | null;
  price: number;
  image_url: string | null;
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
