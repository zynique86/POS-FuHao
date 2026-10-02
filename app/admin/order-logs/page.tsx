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
  const when = new Date(log.created_at).toLocaleString('en-MY');
  const from = (log.details?.from_table as number | string | undefined) ?? '?';
  const to = (log.details?.to_table as number | string | undefined) ?? '?';
  const itemName = log.details?.item_name as string | undefined;
  const itemQty = log.details?.qty as number | undefined;

  const badge =
    log.action === 'remove_order'
      ? { label: '🗑 Order removed', bg: 'var(--brand-50)', fg: 'var(--brand-700)' }
      : log.action === 'remove_item'
      ? { label: '✕ Item removed', bg: 'var(--brand-50)', fg: 'var(--brand-700)' }
      : { label: '🔀 Table change', bg: 'var(--gold-400)/15', fg: 'var(--gold-600)' };

  return (
    <div
      className="bg-white rounded-2xl border border-[var(--ink-200)] p-3.5 md:p-4"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      {/* Top line: badge + who/when (who/when wraps under on phone) */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span
          className="text-[10px] px-2 py-1 rounded-lg font-bold uppercase tracking-widest shrink-0"
          style={{ background: badge.bg, color: badge.fg }}
        >
          {badge.label}
        </span>
        <div className="text-right min-w-0">
          <p className="text-xs md:text-sm font-semibold text-[var(--ink-800)] truncate">
            {log.actor_name || log.actor_email || 'unknown'}
          </p>
          <p className="text-[11px] text-[var(--ink-400)] font-mono">{when}</p>
        </div>
      </div>

      {/* Body */}
      <p className="text-sm text-[var(--ink-900)] font-semibold">
        Order #{log.order_id ?? '—'}
        {log.action === 'change_table' ? (
          <span className="text-[var(--ink-500)] font-normal"> · Table {from} → {to}</span>
        ) : (
          <span className="text-[var(--ink-500)] font-normal"> · Table {log.table_number ?? '—'}</span>
        )}
      </p>
      {log.action === 'remove_item' && itemName && (
        <p className="text-sm text-[var(--ink-700)]">
          {itemQty ? `${itemQty}× ` : ''}{itemName}
        </p>
      )}
      <p className="text-sm text-[var(--ink-600)] break-words">“{log.reason}”</p>
    </div>
  );
}
