'use client';

// Monthly Business Report (月結報表) — the owner's P&L view for a chosen
// month.  Pulls two sources:
//
//   Revenue  ← `orders` where paid_at is inside the month and not voided/refunded
//   Expenses ← `expenses` grouped by kind
//
// The bottom line is "Estimated Operating Profit" — sales minus expenses.
// We label it "estimated" because Food/Material Purchases is the actual
// cash spent on ingredients in the month, not the accounting COGS.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  AdminPageHeader,
  ContentCard,
  ErrorBanner,
  EmptyState,
} from '@/components/ui';
import type { Expense, Order, OrderItem, ExpenseKind } from '@/lib/types';
import { EXPENSE_LABELS, MENU_CATEGORIES, PAY_METHOD_LABELS } from '@/lib/types';
import { businessDateStartISO } from '@/lib/datetime';

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function currentMonthISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthRange(monthISO: string): { start: string; end: string; endInclusive: string } {
  const [y, m] = monthISO.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));       // first day of next month
  const endInclusive = new Date(end.getTime() - 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end), endInclusive: iso(endInclusive) };
}

function fmt(n: number): string {
  return `RM ${(Number(n) || 0).toFixed(2)}`;
}

// -------------------------------------------------------------------------
// Page
// -------------------------------------------------------------------------

export default function MonthlyReportPage() {
  const [month, setMonth]   = useState<string>(currentMonthISO());
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems]   = useState<OrderItem[]>([]);
  const [expenses, setExp]  = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { start, end } = monthRange(month);

      // Only include paid, non-void, non-refund orders in revenue. The
      // boundaries are the shop's own business-day midnight, not raw UTC —
      // otherwise the first ~8 hours of the month (Asia/Kuala_Lumpur is
      // UTC+8) would be attributed to the previous month.
      const oRes = await supabase
        .from('orders')
        .select('*')
        .gte('paid_at', businessDateStartISO(start))
        .lt('paid_at',  businessDateStartISO(end))
        .not('paid_at', 'is', null);
      if (oRes.error) throw oRes.error;

      const orderList = ((oRes.data ?? []) as Order[])
        .filter((o) => o.status !== 'void' && o.status !== 'refunded' && o.voided_at == null);
      setOrders(orderList);

      const ids = orderList.map((o) => o.id);
      let itemList: OrderItem[] = [];
      if (ids.length > 0) {
        const iRes = await supabase
          .from('order_items')
          .select('*')
          .in('order_id', ids);
        if (iRes.error) throw iRes.error;
        itemList = ((iRes.data ?? []) as OrderItem[]).filter((i) => i.voided_at == null);
      }
      setItems(itemList);

      // Expenses in the month
      const eRes = await supabase
        .from('expenses')
        .select('*')
        .gte('business_date', start)
        .lt('business_date',  end);
      if (eRes.error) throw eRes.error;
      setExp((eRes.data ?? []) as Expense[]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- Revenue side ------------------------------------------------------
  const totalRevenue = useMemo(
    () => orders.reduce((s, o) => s + Number(o.total || 0), 0),
    [orders]
  );

  const payBreakdown = useMemo(() => {
    const out: Record<string, number> = {};
    for (const o of orders) {
      const k = o.payment_method ?? 'unknown';
      out[k] = (out[k] || 0) + Number(o.total || 0);
    }
    return out;
  }, [orders]);

  const menuMap = useMenuMap();

  const categoryBreakdown = useMemo(() => {
    const out: Record<string, number> = {};
    for (const it of items) {
      const cat = it.menu_item_id ? menuMap.get(it.menu_item_id) ?? 'Other' : 'Other';
      out[cat] = (out[cat] || 0) + Number(it.price_at_time) * Number(it.qty);
    }
    return out;
  }, [items, menuMap]);

  // ---- Expense side ------------------------------------------------------
  const expenseByKind = useMemo(() => {
    const out: Record<ExpenseKind, number> = {
      wages: 0, meal: 0, purchase: 0, other: 0, rent: 0, utility: 0,
    };
    for (const r of expenses) out[r.kind] += Number(r.amount);
    return out;
  }, [expenses]);

  const totalExpenses = useMemo(
    () => (Object.values(expenseByKind) as number[]).reduce((s, v) => s + v, 0),
    [expenseByKind]
  );

  const profit = totalRevenue - totalExpenses;
  const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1400px] mx-auto px-4 md:px-8 py-8">
      <AdminPageHeader
        title="Monthly Business Report"
        titleZh="月結報表"
        sub="Revenue, expenses and estimated operating profit / 收入、支出、預估經營利潤"
        right={
          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-widest text-[var(--ink-500)] font-semibold">
              Month · 月份
            </label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-2 rounded-xl border border-[var(--ink-200)] bg-white font-mono text-sm"
            />
          </div>
        }
      />

      {err && <ErrorBanner>{err}</ErrorBanner>}

      {loading ? (
        <p className="text-sm text-[var(--ink-500)]">Loading…</p>
      ) : orders.length === 0 && expenses.length === 0 ? (
        <EmptyState
          emoji="📊"
          title="No data for this month"
          sub="Pick a different month to see the report."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* -------- Revenue section -------- */}
          <ContentCard>
            <SectionHeader emoji="💰" title="Revenue" zh="收入" />
            <BigNumber label="Total Sales · 總銷售額" value={totalRevenue} accent="brand" />

            <h3 className="mt-6 text-sm uppercase tracking-widest text-[var(--ink-500)] font-semibold">
              By payment method · 按付款方式
            </h3>
            <BreakdownList items={Object.entries(payBreakdown).map(([k, v]) => ({
              label: PAY_METHOD_LABELS[k as keyof typeof PAY_METHOD_LABELS]?.label ?? k,
              labelZh: PAY_METHOD_LABELS[k as keyof typeof PAY_METHOD_LABELS]?.label_zh ?? '',
              emoji: PAY_METHOD_LABELS[k as keyof typeof PAY_METHOD_LABELS]?.emoji ?? '',
              amount: v,
            }))} total={totalRevenue} />

            <h3 className="mt-6 text-sm uppercase tracking-widest text-[var(--ink-500)] font-semibold">
              By category · 按類別
            </h3>
            <BreakdownList items={MENU_CATEGORIES.map((c) => ({
              label: c.label, labelZh: c.label_zh, emoji: c.emoji,
              amount: categoryBreakdown[c.key] ?? 0,
            })).filter((r) => r.amount > 0)} total={totalRevenue} />
          </ContentCard>

          {/* -------- Expenses section -------- */}
          <ContentCard>
            <SectionHeader emoji="📤" title="Expenses" zh="支出" />
            <BigNumber label="Total Expenses · 總支出" value={totalExpenses} accent="ink" />

            <h3 className="mt-6 text-sm uppercase tracking-widest text-[var(--ink-500)] font-semibold">
              By kind · 按類型
            </h3>
            <BreakdownList items={(Object.keys(EXPENSE_LABELS) as ExpenseKind[]).map((k) => ({
              label: EXPENSE_LABELS[k].label,
              labelZh: EXPENSE_LABELS[k].label_zh,
              emoji: EXPENSE_LABELS[k].emoji,
              amount: expenseByKind[k],
            })).filter((r) => r.amount > 0)} total={totalExpenses} />

            <div className="mt-5 rounded-2xl p-4 bg-[var(--cream-200)] text-[13px] text-[var(--ink-700)]">
              <b className="text-[var(--brand-700)]">Note · 備註:</b>{' '}
              Food / Material Purchases here is the <b>actual cash spent this month</b> — not the accounting cost-of-goods-sold. The owner tracks cashflow, not inventory value.
            </div>
          </ContentCard>

          {/* -------- Profit bar (full width) -------- */}
          <div className="lg:col-span-2">
            <ContentCard className="!p-0 overflow-hidden">
              <div
                className="p-6 md:p-8 text-white"
                style={{ background: profit >= 0
                  ? 'linear-gradient(135deg, var(--jade-500), var(--jade-600))'
                  : 'linear-gradient(135deg, var(--brand-600), var(--brand-800))' }}
              >
                <p className="text-xs uppercase tracking-widest opacity-80">
                  Estimated Operating Profit · 預估經營利潤
                </p>
                <p className="text-4xl md:text-5xl font-bold mt-2">{fmt(profit)}</p>
                <p className="text-sm opacity-90 mt-1">
                  {profit >= 0 ? 'Profit' : 'Loss'} · Margin {margin.toFixed(1)}%
                </p>
                <p className="text-xs opacity-75 mt-4">
                  Total Sales <b>{fmt(totalRevenue)}</b> − Total Expenses <b>{fmt(totalExpenses)}</b> = <b>{fmt(profit)}</b>
                </p>
              </div>
            </ContentCard>
          </div>
        </div>
      )}
    </main>
  );
}

// -------------------------------------------------------------------------
// Small pieces
// -------------------------------------------------------------------------

function SectionHeader({ emoji, title, zh }: { emoji: string; title: string; zh: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <span className="text-xl">{emoji}</span>
      <h2 className="text-xl font-bold text-[var(--ink-900)]">{title}</h2>
      <span className="text-[var(--ink-500)]">· {zh}</span>
    </div>
  );
}

function BigNumber({
  label, value, accent,
}: { label: string; value: number; accent: 'brand' | 'jade' | 'ink' }) {
  const color =
    accent === 'brand' ? 'var(--brand-700)'
    : accent === 'jade' ? 'var(--jade-600)'
    : 'var(--ink-900)';
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-[var(--ink-500)] font-semibold">
        {label}
      </p>
      <p className="text-3xl md:text-4xl font-bold mt-1" style={{ color }}>{fmt(value)}</p>
    </div>
  );
}

function BreakdownList({
  items, total,
}: {
  items: { label: string; labelZh: string; emoji: string; amount: number }[];
  total: number;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--ink-400)] italic mt-2">No entries.</p>;
  }
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  return (
    <ul className="mt-2 space-y-2">
      {sorted.map((it, i) => {
        const pct = total > 0 ? (it.amount / total) * 100 : 0;
        return (
          <li key={i} className="flex items-center gap-3 py-1">
            <span className="text-lg w-6">{it.emoji}</span>
            <span className="flex-1 min-w-0">
              <span className="font-semibold text-sm text-[var(--ink-900)]">{it.label}</span>
              <span className="ml-2 text-xs text-[var(--ink-500)]">{it.labelZh}</span>
              <div className="mt-1 h-1.5 rounded-full bg-[var(--ink-100)] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: 'linear-gradient(90deg, var(--gold-400), var(--brand-500))',
                  }}
                />
              </div>
            </span>
            <span className="text-right">
              <span className="block font-mono font-semibold text-sm text-[var(--ink-900)]">{fmt(it.amount)}</span>
              <span className="block text-[10px] text-[var(--ink-400)]">{pct.toFixed(1)}%</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// Fetch a map of menu_item_id → category once; used in the category
// breakdown so we don't have to join on the DB side.
function useMenuMap() {
  const [map, setMap] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('menu_items').select('id, category');
      const m = new Map<number, string>();
      for (const r of (data ?? []) as { id: number; category: string }[]) {
        m.set(r.id, r.category);
      }
      setMap(m);
    })();
  }, []);
  return map;
}
