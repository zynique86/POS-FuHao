// Fetch and (optionally) live-subscribe to the singleton shop_settings row.

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { ShopSettings } from './types';

const FALLBACK: ShopSettings = {
  id: 1,
  shop_name: 'DIM SUM SHOP',
  shop_name_zh: '',
  address: '',
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
  return (data as ShopSettings) ?? FALLBACK;
}

// React hook: initial fetch + live updates when admin edits settings.
export function useSettings(initial?: ShopSettings): ShopSettings {
  const [settings, setSettings] = useState<ShopSettings>(initial ?? FALLBACK);

  useEffect(() => {
    if (!initial) {
      fetchSettings().then(setSettings);
    }
    const channel = supabase
      .channel('shop_settings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shop_settings' },
        (payload) => {
          if (payload.new) setSettings(payload.new as ShopSettings);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [initial]);

  return settings;
}
