// Shared DB row types — mirror the Supabase schema.
// Kept in one place so pages, services and the printer stay in sync.

export type MenuItem = {
  id: number;
  name_en: string;
  name_zh: string | null;
  price: number;
  category: string;
  is_available: boolean;
  sort_order: number;
};

export type OrderItem = {
  id: number;
  order_id: number;
  menu_item_id: number | null;
  name_snapshot: string;
  name_zh_snapshot: string | null;
  qty: number;
  price_at_time: number;
  kitchen_status: string;
};

export type OrderStatus = 'open' | 'closed' | 'paid' | 'void';

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
