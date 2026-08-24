'use client';

// Client hook: initial value from the server-fetched settings, plus
// live updates when admin edits shop_settings.

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { FALLBACK_SETTINGS, fetchSettings } from './settings';
import type { ShopSettings } from './types';

export function useSettings(initial?: ShopSettings): ShopSettings {
  const [settings, setSettings] = useState<ShopSettings>(
    initial ?? FALLBACK_SETTINGS
  );

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
