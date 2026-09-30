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

export async function deleteExpense(id: number, actorEmail: string, reason?: string) {
  const { data: existing } = await supabase.from('expenses').select('*').eq('id', id).single();
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw toError(error, 'Failed to delete expense');
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

// Returns `true` if the audit row landed in the DB, `false` if it failed
// silently.  Callers that want a hard failure can throw on `false`.
export async function logAudit(entry: NewAuditEntry): Promise<boolean> {
  try {
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
    if (error) {
      // Log a readable line so the browser console shows the real reason
      // when RLS or a missing table blocks writes.
      const msg = toError(error, 'audit insert failed').message;
      console.warn(`[audit] failed to log "${entry.action}":`, msg, entry);
      return false;
    }
    return true;
  } catch (e: unknown) {
    console.warn(`[audit] threw while logging "${entry.action}":`, toError(e).message);
    return false;
  }
}

export async function listAudit(limit = 200): Promise<AuditLog[]> {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw toError(error, 'Failed to load audit log');
  return (data ?? []) as AuditLog[];
}
