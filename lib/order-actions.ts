// Order-level actions that ANY signed-in staff member can take — removing a
// whole order, or moving it to a different table.  Each action is written to
// `order_logs` with who did it and the reason, so there's an accountable trail.

import { supabase } from './supabase';
import { getCurrentUser } from './roles';
import type { OrderLog } from './types';

/**
 * Remove (void) a whole order.  Sets the order's status to 'void' so it drops
 * off the cashier's unpaid list AND off the kitchen / bar / counter screens
 * (those only show status = 'open').  Logs who removed it and why.
 */
export async function removeOrder(
  orderId: number,
  tableNumber: number | null,
  reason: string
): Promise<void> {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error('A reason is required to remove an order.');

  const me = await getCurrentUser();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('orders')
    .update({
      status: 'void',
      voided_at: now,
      void_reason: trimmed,
      voided_by: me.email,
    })
    .eq('id', orderId);
  if (error) throw error;

  // Best-effort log.  Don't block the action if the log table isn't migrated
  // yet — but surface the error to the console for the operator.
  const { error: logErr } = await supabase.from('order_logs').insert({
    order_id: orderId,
    table_number: tableNumber,
    action: 'remove_order',
    reason: trimmed,
    actor_email: me.email,
    actor_name: me.name,
  });
  if (logErr) console.error('order_logs insert (remove_order) failed:', logErr.message);
}

/**
 * Move an order to a different table number.  Logs who moved it, from/to, why.
 */
export async function changeTable(
  orderId: number,
  fromTable: number | null,
  toTable: number,
  reason: string
): Promise<void> {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error('A reason is required to change the table.');
  if (!Number.isFinite(toTable) || toTable < 1) {
    throw new Error('Enter a valid table number.');
  }

  const me = await getCurrentUser();

  const { error } = await supabase
    .from('orders')
    .update({ table_number: toTable })
    .eq('id', orderId);
  if (error) throw error;

  const { error: logErr } = await supabase.from('order_logs').insert({
    order_id: orderId,
    table_number: toTable,
    action: 'change_table',
    reason: trimmed,
    actor_email: me.email,
    actor_name: me.name,
    details: { from_table: fromTable, to_table: toTable },
  });
  if (logErr) console.error('order_logs insert (change_table) failed:', logErr.message);
}

export async function listOrderLogs(limit = 200): Promise<OrderLog[]> {
  const { data } = await supabase
    .from('order_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as OrderLog[];
}
