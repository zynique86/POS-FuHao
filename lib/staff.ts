// Staff table helpers — used for PIN gating and CRUD.

import { supabase } from './supabase';
import type { Staff, StaffRole } from './types';
export type { Staff, StaffRole };

// Verify a PIN against any active staff with role >= supervisor.
// Returns the matching staff row (name/role) on success, or null.
export async function verifyManagerPin(pin: string): Promise<Staff | null> {
  const clean = pin.trim();
  if (!clean) return null;
  const { data } = await supabase
    .from('staff')
    .select('*')
    .eq('pin', clean)
    .eq('active', true)
    .in('role', ['supervisor', 'owner']);
  return (data?.[0] as Staff) ?? null;
}

// Verify a PIN against any active staff (any role) — for shift open, etc.
export async function verifyAnyPin(pin: string): Promise<Staff | null> {
  const clean = pin.trim();
  if (!clean) return null;
  const { data } = await supabase
    .from('staff')
    .select('*')
    .eq('pin', clean)
    .eq('active', true);
  return (data?.[0] as Staff) ?? null;
}

export async function listStaff(): Promise<Staff[]> {
  const { data } = await supabase
    .from('staff')
    .select('*')
    .order('active', { ascending: false })
    .order('id');
  return (data ?? []) as Staff[];
}
