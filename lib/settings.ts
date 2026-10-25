// Server-safe settings fetcher — NO React imports here, so this module
// can be pulled into a React Server Component (app/page.tsx, admin pages).
// The client-side live hook lives in ./use-settings.ts.

import { supabase } from './supabase';
import type { ShopSettings } from './types';

export const FALLBACK_SETTINGS: ShopSettings = {
  id: 1,
  shop_name: 'DIM SUM SHOP',
  shop_name_zh: '',
  address: '',
  phone: '',
  tax_id: '',
  wifi_ssid: '',
  wifi_password: '',
  receipt_thank_you: '',
  receipt_come_again: '',
  sst_pct: 0,
  service_charge_pct: 0,
  round_to_5_sen: true,
  updated_at: new Date(0).toISOString(),
};

export async function fetchSettings(): Promise<ShopSettings> {
  const { data } = await supabase
    .from('shop_settings')
    .select('*')
    .eq('id', 1)
    .single();
  return (data as ShopSettings) ?? FALLBACK_SETTINGS;
}
