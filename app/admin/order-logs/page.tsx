'use client';

// Order action log — who removed an order or changed a table, and why.
// Read-only accountability trail; any signed-in user can view it.

import { useEffect, useState } from 'react';
import { AdminPageHeader, EmptyState } from '@/components/ui';
import { listOrderLogs } from '@/lib/order-actions';
import { supabase } from '@/lib/supabase';
import type { OrderLog } from '@/lib/types';

export default function OrderLogsPage() {
  const [logs, setLogs] = useState<OrderLog[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLogs(await listOrderLogs(300));
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel('order-logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_logs' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1100px] mx-auto px-4 md:px-8 py-8">
      <AdminPageHeader
        title="Order Log"
        titleZh="操作記錄"
        sub="Every order removal and table change, with who did it and why."
      />

      {loading ? (
        <p className="text-[var(--ink-500)]">Loading…</p>
      ) : logs.length === 0 ? (
        <EmptyState emoji="📝" title="No actions yet" sub="Removals and table changes will show up here." />
      ) : (
        <div className="space-y-2">
          {logs.map((l) => (
            <LogRow key={l.id} log={l} />
          ))}
        </div>
      )}
    </main>
  );
}

function LogRow({ log }: { log: OrderLog }) {
  const isRemove = log.action === 'remove_order';
  const when = new Date(log.created_at).toLocaleString('en-MY');
  const from = (log.details?.from_table as number | string | undefined) ?? '?';
  const to = (log.details?.to_table as number | string | undefined) ?? '?';

  return (
    <div
      className="bg-white rounded-2xl border border-[var(--ink-200)] p-4 flex flex-wrap items-center gap-x-4 gap-y-2"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <span
        className="text-[10px] px-2 py-1 rounded-lg font-bold uppercase tracking-widest shrink-0"
        style={
          isRemove
            ? { background: 'var(--brand-50)', color: 'var(--brand-700)' }
            : { background: 'var(--gold-400)/15', color: 'var(--gold-600)' }
        }
      >
        {isRemove ? '🗑 Removed' : '🔀 Table change'}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--ink-900)] font-semibold">
          Order #{log.order_id ?? '—'}
          {isRemove ? (
            <span className="text-[var(--ink-500)] font-normal"> · Table {log.table_number ?? '—'}</span>
          ) : (
            <span className="text-[var(--ink-500)] font-normal"> · Table {from} → {to}</span>
          )}
        </p>
        <p className="text-sm text-[var(--ink-600)]">“{log.reason}”</p>
      </div>

      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-[var(--ink-800)]">
          {log.actor_name || log.actor_email || 'unknown'}
        </p>
        <p className="text-[11px] text-[var(--ink-400)] font-mono">{when}</p>
      </div>
    </div>
  );
}
