// Helpers for the shift_opens table.

import { supabase } from './supabase';
import { businessTodayISO } from './datetime';

export type Shift = {
  id: number;
  business_date: string;
  opened_at: string;
  opened_by: string | null;
  opening_float: number;
  closed_at: string | null;
  closed_by: string | null;
  closing_count: number | null;
  expected_close: number | null;
  variance: number | null;
  notes: string | null;
};

export function todayISODate(): string {
  return businessTodayISO();
}

// Fetch the open (not-yet-closed) shift for the given business date.
export async function fetchOpenShift(dateISO: string): Promise<Shift | null> {
  const { data } = await supabase
    .from('shift_opens')
    .select('*')
    .eq('business_date', dateISO)
    .is('closed_at', null)
    .order('opened_at', { ascending: false })
    .limit(1);
  return (data?.[0] as Shift) ?? null;
}

// Fetch the closed shift for a given business date (used by Z-report).
export async function fetchShiftForDate(dateISO: string): Promise<Shift | null> {
  const { data } = await supabase
    .from('shift_opens')
    .select('*')
    .eq('business_date', dateISO)
    .order('opened_at', { ascending: false })
    .limit(1);
  return (data?.[0] as Shift) ?? null;
}

export async function openShift(openingFloat: number, openedBy: string): Promise<Shift | null> {
  const { data, error } = await supabase
    .from('shift_opens')
    .insert({
      business_date: todayISODate(),
      opening_float: openingFloat,
      opened_by: openedBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Shift;
}

export async function closeShift(
  shiftId: number,
  closingCount: number,
  cashSales: number,
  closedBy: string,
  notes?: string
): Promise<void> {
  // Fetch opening float to compute expected close
  const { data: shift } = await supabase
    .from('shift_opens')
    .select('opening_float')
    .eq('id', shiftId)
    .single();
  const openingFloat = Number(shift?.opening_float ?? 0);
  const expectedClose = openingFloat + cashSales;
  const variance = closingCount - expectedClose;

  await supabase
    .from('shift_opens')
    .update({
      closed_at: new Date().toISOString(),
      closed_by: closedBy,
      closing_count: closingCount,
      expected_close: expectedClose,
      variance,
      notes: notes ?? null,
    })
    .eq('id', shiftId);
}
