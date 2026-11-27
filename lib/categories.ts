'use client';

// Menu categories + which printer each one prints at.
//
// The list lives in the category_station_routing table (see
// migrations/editable_categories.sql) and is edited by admins in
// Admin > Menu > "Categories & printers".  send_order() in the database
// reads the same table to decide where each kitchen ticket prints, so the
// screens here and the printed tickets always agree.
//
// If the table can't be read (offline, or the migration hasn't run yet) we
// fall back to the built-in list in lib/types.ts so the POS keeps working.

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import {
  MENU_CATEGORIES,
  setLiveCategoryStations,
  stationForCategory,
  type PrintStation,
} from './types';

export type MenuCategory = {
  key: string;            // lower-cased name — the table's primary key
  name: string;           // exact text stored in menu_items.category
  name_zh: string | null;
  emoji: string | null;
  station: PrintStation;
  position: number;
};

export const DEFAULT_CATEGORIES: MenuCategory[] = MENU_CATEGORIES.map((c, i) => ({
  key: c.key.toLowerCase(),
  name: c.key,
  name_zh: c.label_zh,
  emoji: c.emoji,
  station: stationForCategory(c.key),
  position: (i + 1) * 10,
}));

let cache: MenuCategory[] | null = null;
let inflight: Promise<MenuCategory[]> | null = null;
const listeners = new Set<(c: MenuCategory[]) => void>();

function publish(list: MenuCategory[]) {
  cache = list;
  const map: Record<string, PrintStation> = {};
  for (const c of list) map[c.key] = c.station;
  setLiveCategoryStations(map);
  listeners.forEach((fn) => fn(list));
}

// Fetch from the DB (once; pass force=true to refetch).  Never throws —
// returns the built-in defaults when the table can't be read.
export async function loadCategories(force = false): Promise<MenuCategory[]> {
  if (cache && !force) return cache;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    const { data, error } = await supabase
      .from('category_station_routing')
      .select('category, station, name, name_zh, emoji, position')
      .order('position')
      .order('name');
    inflight = null;
    if (error || !data) {
      if (error) console.warn('Categories: using built-in list —', error.message);
      return cache ?? DEFAULT_CATEGORIES;
    }
    const list: MenuCategory[] = data.map((r) => ({
      key: String(r.category),
      name: (r.name as string | null) ?? String(r.category),
      name_zh: (r.name_zh as string | null) ?? null,
      emoji: (r.emoji as string | null) ?? null,
      station: r.station as PrintStation,
      position: Number(r.position) || 0,
    }));
    publish(list);
    return list;
  })();
  return inflight;
}

// Find the category row for an item's category text.
export function findCategory(list: MenuCategory[], category: string | null | undefined) {
  const k = (category || '').trim().toLowerCase();
  return list.find((c) => c.key === k);
}

// Sort [categoryName, items] groups by the admin-defined order; unknown
// names go last alphabetically.
export function sortByCategoryOrder<T>(entries: [string, T][], list: MenuCategory[]): [string, T][] {
  const idx = (name: string) => list.findIndex((c) => c.key === name.trim().toLowerCase());
  return [...entries].sort(([a], [b]) => {
    const ia = idx(a);
    const ib = idx(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

// React hook: the live category list, updated when an admin edits it.
export function useMenuCategories(): MenuCategory[] {
  const [list, setList] = useState<MenuCategory[]>(cache ?? DEFAULT_CATEGORIES);
  useEffect(() => {
    listeners.add(setList);
    loadCategories().then(setList);
    const channel = supabase
      .channel(`menu-categories-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'category_station_routing' },
        () => { loadCategories(true); }
      )
      .subscribe();
    return () => {
      listeners.delete(setList);
      supabase.removeChannel(channel);
    };
  }, []);
  return list;
}
