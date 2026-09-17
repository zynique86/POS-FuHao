// Data helpers for the expenses / audit-log tables.
// One place so pages, dashboards and reports stay consistent.

import { supabase } from './supabase';
import type {
  Expense,
  ExpenseKind,
  AuditAction,
  AuditLog,
  StaffRole,
} from './types';

// -------------------------------------------------------------------------
// EXPENSES
// -------------------------------------------------------------------------

export async function listExpensesForDate(businessDate: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('business_date', businessDate)
    .order('created_at', { ascending: true });
  if (error) throw error;
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
  if (error) throw error;
  return (data ?? []) as Expense[];
}

export async function insertExpense(row: Omit<Expense, 'id' | 'created_at'>) {
  const { data, error } = await supabase.from('expenses').insert(row).select('*').single();
  if (error) throw error;
  return data as Expense;
}

export async function updateExpense(id: number, patch: Partial<Expense>) {
  const { data, error } = await supabase
    .from('expenses')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Expense;
}

export async function deleteExpense(id: number, actorEmail: string, reason?: string) {
  // Look up the row first so we can audit exactly what was removed.
  const { data: existing } = await supabase.from('expenses').select('*').eq('id', id).single();
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;
  await logAudit({
    actor_email: actorEmail,
    action: 'expense_delete',
    target_type: 'expense',
    target_id: id,
    amount: existing?.amount ?? null,
    reason: reason ?? null,
    details: existing ?? null,
  });
}

export function sumExpenses(rows: Expense[], kind?: ExpenseKind): number {
  const list = kind ? rows.filter((r) => r.kind === kind) : rows;
  return list.reduce((s, r) => s + Number(r.amount || 0), 0);
}

// -------------------------------------------------------------------------
// AUDIT LOG
// -------------------------------------------------------------------------

export type NewAuditEntry = {
  actor_email: string | null;
  actor_role?: StaffRole | null;
  action: AuditAction;
  target_type?: string | null;
  target_id?: number | null;
  amount?: number | null;
  reason?: string | null;
  details?: Record<string, unknown> | null;
};

export async function logAudit(entry: NewAuditEntry) {
  const payload = {
    actor_email: entry.actor_email,
    actor_role: entry.actor_role ?? null,
    action: entry.action,
    target_type: entry.target_type ?? null,
    target_id: entry.target_id ?? null,
    amount: entry.amount ?? null,
    reason: entry.reason ?? null,
    details: entry.details ?? null,
  };
  const { error } = await supabase.from('audit_log').insert(payload);
  if (error) console.warn('[audit] failed to log', entry, error);
}

export async function listAudit(limit = 200): Promise<AuditLog[]> {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuditLog[];
}
