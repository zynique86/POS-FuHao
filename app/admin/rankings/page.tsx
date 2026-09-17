'use client';

// Food & Category Rankings (銷售排行) — answers "what sells the most?"
//
// Two rankings side by side:
//   1. Top-selling food items      (Rank / Name / Qty / Sales)
//   2. Category sales breakdown    (share of total sales by category)
//
// Date range is user-choosable — this month by default.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminPageHeader, ContentCard, ErrorBanner, EmptyState } from '@/components/ui';
import { MENU_CATEGORIES, type MenuItem, type OrderItem } from '@/lib/types';

type RangeKey = 'today' | 'week' | 'month' | 'custom';

function todayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function firstOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function fmt(n: number): string {
  return `RM ${(Number(n) || 0).toFixed(2)}`;
}

export default function RankingsPage() {
  const [range, setRange] = useState<RangeKey>('month');
  const [start, setStart] = useState<string>(firstOfMonthISO());
  const [end, setEnd]     = useState<string>(todayISO());

  const [menu, setMenu]   = useState<MenuItem[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);

  // Update the actual start/end when the range preset changes.
  useEffect(() => {
    if (range === 'today')       { setStart(todayISO());       setEnd(todayISO()); }
    else if (range === 'week')   { setStart(daysAgoISO(6));    setEnd(todayISO()); }
    else if (range === 'month')  { setStart(firstOfMonthISO()); setEnd(todayISO()); }
  }, [range]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const oRes = await supabase
        .from('orders')
        .select('id, paid_at, status, voided_at')
        .gte('paid_at', `${start}T00:00:00Z`)
        .lte('paid_at', `${end}T23:59:59Z`)
        .not('paid_at', 'is', null);
      if (oRes.error) throw oRes.error;

      const paidIds = (oRes.data ?? [])
        .filter((o) => o.status !== 'void' && o.status !== 'refunded' && o.voided_at == null)
        .map((o) => o.id);

      let itemList: OrderItem[] = [];
      if (paidIds.length > 0) {
        const iRes = await supabase.from('order_items').select('*').in('order_id', paidIds);
        if (iRes.error) throw iRes.error;
        itemList = ((iRes.data ?? []) as OrderItem[]).filter((i) => i.voided_at == null);
      }
      setItems(itemList);

      const mRes = await supabase.from('menu_items').select('*');
      if (mRes.error) throw mRes.error;
      setMenu((mRes.data ?? []) as MenuItem[]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    load();
  }, [load]);

  // -- Top food ----------------------------------------------------------
  const menuMap = useMemo(() => {
    const m = new Map<number, MenuItem>();
    for (const it of menu) m.set(it.id, it);
    return m;
  }, [menu]);

  const foodRanking = useMemo(() => {
    const agg = new Map<string, { name: string; nameZh: string | null; category: string; qty: number; sales: number }>();
    for (const it of items) {
      const key = it.menu_item_id ? `id:${it.menu_item_id}` : `name:${it.name_snapshot}`;
      const cat = it.menu_item_id ? menuMap.get(it.menu_item_id)?.category ?? 'Other' : 'Other';
      const row = agg.get(key) ?? {
        name: it.name_snapshot,
        nameZh: it.name_zh_snapshot,
        category: cat,
        qty: 0,
        sales: 0,
      };
      row.qty   += Number(it.qty);
      row.sales += Number(it.qty) * Number(it.price_at_time);
      agg.set(key, row);
    }
    return [...agg.values()].sort((a, b) => b.sales - a.sales);
  }, [items, menuMap]);

  const totalSales = foodRanking.reduce((s, r) => s + r.sales, 0);

  // -- Category breakdown ------------------------------------------------
  const catRanking = useMemo(() => {
    const agg = new Map<string, { key: string; sales: number; qty: number }>();
    for (const r of foodRanking) {
      const row = agg.get(r.category) ?? { key: r.category, sales: 0, qty: 0 };
      row.sales += r.sales;
      row.qty   += r.qty;
      agg.set(r.category, row);
    }
    return [...agg.values()].sort((a, b) => b.sales - a.sales);
  }, [foodRanking]);

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1400px] mx-auto px-4 md:px-8 py-8">
      <AdminPageHeader
        title="Sales Rankings"
        titleZh="銷售排行"
        sub="Which foods and categories sell the most / 最暢銷的食品與分類"
        right={
          <div className="flex flex-wrap items-center gap-2">
            {(['today','week','month','custom'] as RangeKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setRange(k)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                  range === k
                    ? 'bg-[var(--brand-600)] text-white'
                    : 'bg-white border border-[var(--ink-200)] text-[var(--ink-700)]'
                }`}
              >
                {k === 'today' ? 'Today' : k === 'week' ? '7 days' : k === 'month' ? 'This Month' : 'Custom'}
              </button>
            ))}
            {range === 'custom' && (
              <div className="flex gap-2">
                <input
                  type="date" value={start} onChange={(e) => setStart(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-[var(--ink-200)] font-mono text-xs"
                />
                <input
                  type="date" value={end} onChange={(e) => setEnd(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-[var(--ink-200)] font-mono text-xs"
                />
              </div>
            )}
          </div>
        }
      />

      {err && <ErrorBanner>{err}</ErrorBanner>}

      {loading ? (
        <p className="text-sm text-[var(--ink-500)]">Loading…</p>
      ) : foodRanking.length === 0 ? (
        <EmptyState emoji="🏆" title="No sales in this range" sub="Change the date range to see results." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Food rankings — 2/3 width */}
          <div className="lg:col-span-2">
            <ContentCard>
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-xl font-bold text-[var(--ink-900)]">
                  🏆 Top Selling Food <span className="text-[var(--ink-500)] font-normal">· 最暢銷食品</span>
                </h2>
                <span className="text-sm text-[var(--ink-500)]">Total {fmt(totalSales)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-widest text-[var(--ink-500)] border-b border-[var(--ink-200)]">
                      <th className="py-2 pr-2 w-10">#</th>
                      <th className="py-2 pr-2">Food · 食品</th>
                      <th className="py-2 pr-2 text-right">Qty · 數量</th>
                      <th className="py-2 text-right">Sales · 銷售額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {foodRanking.slice(0, 30).map((r, i) => (
                      <tr key={i} className="border-b border-[var(--ink-100)] last:border-none">
                        <td className="py-2 pr-2 font-mono font-bold text-[var(--ink-500)]">
                          {i + 1}
                        </td>
                        <td className="py-2 pr-2">
                          <p className="font-semibold text-[var(--ink-900)]">{r.name}</p>
                          {r.nameZh && <p className="text-xs text-[var(--ink-500)]">{r.nameZh}</p>}
                          <p className="text-[10px] text-[var(--ink-400)] mt-0.5">{r.category}</p>
                        </td>
                        <td className="py-2 pr-2 text-right font-semibold">{r.qty}</td>
                        <td className="py-2 text-right font-mono font-semibold">{fmt(r.sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ContentCard>
          </div>

          {/* Category rankings — 1/3 width */}
          <div>
            <ContentCard>
              <h2 className="text-xl font-bold text-[var(--ink-900)] mb-4">
                📊 Category <span className="text-[var(--ink-500)] font-normal">· 分類</span>
              </h2>
              <ul className="space-y-3">
                {catRanking.map((c, i) => {
                  const meta = MENU_CATEGORIES.find((m) => m.key === c.key)
                    ?? { key: c.key, label: c.key, label_zh: '', emoji: '📦' };
                  const pct = totalSales > 0 ? (c.sales / totalSales) * 100 : 0;
                  return (
                    <li key={i}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{meta.emoji}</span>
                        <span className="font-semibold text-sm text-[var(--ink-900)] flex-1">{meta.label}</span>
                        <span className="font-mono text-sm font-semibold">{fmt(c.sales)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-[var(--ink-100)] overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: 'linear-gradient(90deg, var(--gold-400), var(--brand-500))',
                            }}
                          />
                        </div>
                        <span className="text-[10px] text-[var(--ink-500)] font-mono w-12 text-right">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--ink-500)] mt-0.5">
                        {meta.label_zh} · {c.qty} items
                      </p>
                    </li>
                  );
                })}
              </ul>
            </ContentCard>
          </div>
        </div>
      )}
    </main>
  );
}
