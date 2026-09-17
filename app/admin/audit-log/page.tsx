'use client';

// Audit Log (操作日誌) — read-only viewer of every sensitive action:
// void, refund, discount, price change, deletions.  Owner-only.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { useCallback, useEffect, useState } from 'react';
import { AdminPageHeader, ContentCard, ErrorBanner, EmptyState } from '@/components/ui';
import { listAudit } from '@/lib/expenses';
import type { AuditLog, AuditAction } from '@/lib/types';
import { AUDIT_ACTION_LABELS } from '@/lib/types';

const ACTIONS: (AuditAction | 'all')[] = [
  'all', 'void', 'refund', 'discount', 'price_change',
  'expense_delete', 'menu_item_delete', 'staff_role_change', 'staff_delete',
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-MY', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [filter, setFilter] = useState<(typeof ACTIONS)[number]>('all');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const list = await listAudit(500);
      setRows(list);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.action === filter);

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1200px] mx-auto px-4 md:px-8 py-8">
      <AdminPageHeader
        title="Audit Log"
        titleZh="操作日誌"
        sub="Void / refund / discount / price changes — who, when, why / 記錄敏感操作"
      />

      {err && <ErrorBanner>{err}</ErrorBanner>}

      <ContentCard>
        <div className="flex flex-wrap gap-2 mb-5">
          {ACTIONS.map((a) => {
            const meta = a === 'all'
              ? { label: 'All', label_zh: '全部', emoji: '📋' }
              : AUDIT_ACTION_LABELS[a as AuditAction];
            const active = filter === a;
            return (
              <button
                key={a}
                onClick={() => setFilter(a)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                  active ? 'bg-[var(--brand-600)] text-white' : 'bg-white border border-[var(--ink-200)] text-[var(--ink-700)]'
                }`}
              >
                <span>{meta.emoji}</span>
                {meta.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <p className="text-sm text-[var(--ink-500)]">Loading…</p>
        ) : filtered.length === 0 ? (
          <EmptyState emoji="🔒" title="No audit entries yet" sub="Sensitive actions will appear here." />
        ) : (
          <ul className="divide-y divide-[var(--ink-100)]">
            {filtered.map((r) => {
              const meta = AUDIT_ACTION_LABELS[r.action] ?? { emoji: '📝', label: r.action, label_zh: '' };
              return (
                <li key={r.id} className="py-3 flex items-start gap-3">
                  <span className="text-2xl">{meta.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <p className="font-semibold text-[var(--ink-900)]">
                        {meta.label} <span className="text-[var(--ink-500)] font-normal">· {meta.label_zh}</span>
                      </p>
                      {r.amount != null && (
                        <span className="text-sm font-mono text-[var(--brand-700)] font-semibold">
                          RM {Number(r.amount).toFixed(2)}
                        </span>
                      )}
                    </div>
                    {r.target_type && (
                      <p className="text-xs text-[var(--ink-500)]">
                        Target: {r.target_type} #{r.target_id}
                      </p>
                    )}
                    {r.reason && (
                      <p className="text-sm text-[var(--ink-700)] italic mt-1">"{r.reason}"</p>
                    )}
                    <p className="text-xs text-[var(--ink-400)] mt-1">
                      {r.actor_email ?? '(unknown user)'}
                      {r.actor_role && <> · {r.actor_role}</>}
                      <> · {fmtDate(r.created_at)}</>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ContentCard>
    </main>
  );
}
