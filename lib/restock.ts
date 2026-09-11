// Restock queue helpers.
// A restock request = "the front counter ran out of X, kitchen please make more".
// Independent of customer orders — its own live queue.

import { supabase } from './supabase';
import type { MenuItem, RestockRequest } from './types';

export async function requestRestock(
  item: MenuItem,
  qtyWanted: number | null,
  note: string,
  by: string
): Promise<RestockRequest> {
  const { data, error } = await supabase
    .from('restock_requests')
    .insert({
      menu_item_id: item.id,
      item_name_snapshot: item.name_en,
      item_name_zh_snapshot: item.name_zh,
      qty_wanted: qtyWanted,
      note: note.trim() || null,
      requested_by: by,
    })
    .select()
    .single();
  if (error) throw error;

  // Also enqueue a physical printed slip at the item's own station
  // (drinks → bar printer, food → kitchen printer).
  await supabase.from('print_jobs').insert({
    kind: 'restock',
    station: item.station ?? 'kitchen',
    payload: {
      restock_id: data.id,
      item_name: item.name_en,
      item_name_zh: item.name_zh,
      qty_wanted: qtyWanted,
      note: note.trim() || null,
      by,
    },
  });

  return data as RestockRequest;
}

export async function fulfillRestock(id: number, by: string): Promise<void> {
  await supabase
    .from('restock_requests')
    .update({
      fulfilled_at: new Date().toISOString(),
      fulfilled_by: by,
    })
    .eq('id', id);
}

export async function cancelRestock(id: number): Promise<void> {
  // Same as fulfill, but marks who cancelled with a note prefix.
  await supabase
    .from('restock_requests')
    .update({
      fulfilled_at: new Date().toISOString(),
      fulfilled_by: 'cancelled',
    })
    .eq('id', id);
}

export async function listPendingRestock(): Promise<RestockRequest[]> {
  const { data } = await supabase
    .from('restock_requests')
    .select('*')
    .is('fulfilled_at', null)
    .order('requested_at', { ascending: true });
  return (data ?? []) as RestockRequest[];
}
