// Data helpers for the expenses table.
// One place so pages, dashboards and reports stay consistent.

import { supabase } from './supabase';
import type { Expense, ExpenseKind } from './types';

// -------------------------------------------------------------------------
// Error helper — Supabase returns plain objects ({message, code, hint,
// details}) that aren't real Error instances.  Wrap them so UI code can do
// `err instanceof Error` and read `err.message` — otherwise the app shows
// "[object Object]" on the red banner, which tells the user nothing.
// -------------------------------------------------------------------------
function toError(e: unknown, fallback = 'Something went wrong'): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'object' && e !== null) {
    const obj = e as {
      message?: unknown; hint?: unknown; details?: unknown; code?: unknown;
    };
    const parts: string[] = [];
    if (typeof obj.message === 'string' && obj.message) parts.push(obj.message);
    if (typeof obj.details === 'string' && obj.details) parts.push(obj.details);
    if (typeof obj.hint    === 'string' && obj.hint)    parts.push(`hint: ${obj.hint}`);
    if (typeof obj.code    === 'string' && obj.code)    parts.push(`(${obj.code})`);
    const msg = parts.length ? parts.join(' — ') : fallback;
    return new Error(msg);
  }
  if (typeof e === 'string' && e) return new Error(e);
  return new Error(fallback);
}

// -------------------------------------------------------------------------
// EXPENSES
// -------------------------------------------------------------------------

export async function listExpensesForDate(businessDate: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('business_date', businessDate)
    .order('created_at', { ascending: true });
  if (error) throw toError(error, 'Failed to load expenses');
  return (data ?? []) as Expense[];
}

export async function listExpensesInRange(
  startDate: string,
  endDate: string,
  kind?: ExpenseKind
): Promise<Expense[]> {
  let q = supabase
    .from('expenses')
    .select('*')
    .gte('business_date', startDate)
    .lte('business_date', endDate)
    .order('business_date', { ascending: true });
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q;
  if (error) throw toError(error, 'Failed to load expenses');
  return (data ?? []) as Expense[];
}

export async function insertExpense(row: Omit<Expense, 'id' | 'created_at'>) {
  const { data, error } = await supabase.from('expenses').insert(row).select('*').single();
  if (error) throw toError(error, 'Failed to save expense');
  return data as Expense;
}

export async function updateExpense(id: number, patch: Partial<Expense>) {
  const { data, error } = await supabase
    .from('expenses')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw toError(error, 'Failed to update expense');
  return data as Expense;
}

export async function deleteExpense(id: number) {
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw toError(error, 'Failed to delete expense');
}

export function sumExpenses(rows: Expense[], kind?: ExpenseKind): number {
  const list = kind ? rows.filter((r) => r.kind === kind) : rows;
  return list.reduce((s, r) => s + Number(r.amount || 0), 0);
}
