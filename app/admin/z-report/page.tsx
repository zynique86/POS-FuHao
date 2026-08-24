'use client';

// Daily Z-report: end-of-day summary for any business date.
// Pick a date, see revenue, order count, payment split, voids, top items.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type OrderRow = {
  id: number;
  total: number;
  payment_method: string | null;
  paid_at: string | null;
};

type ItemRow = {
  order_id: number;
  name_snapshot: string;
  qty: number;
  price_at_time: number;
  voided_at: string | null;
};

export default function ZReportPage() {
  const [date, setDate] = useState<string>(todayISO());
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const dayStart = new Date(date + 'T00:00:00');
      const dayEnd = new Date(date + 'T23:59:59.999');
      const [ordersRes, itemsRes] = await Promise.all([
        supabase
          .from('orders')
          .select('id, total, payment_method, paid_at')
          .not('paid_at', 'is', null)
          .gte('paid_at', dayStart.toISOString())
          .lte('paid_at', dayEnd.toISOString()),
        supabase
          .from('order_items')
          .select('order_id, name_snapshot, qty, price_at_time, voided_at')
          .gte('created_at', dayStart.toISOString())
          .lte('created_at', dayEnd.toISOString()),
      ]);
      setOrders((ordersRes.data ?? []) as OrderRow[]);
      setItems((itemsRes.data ?? []) as ItemRow[]);
      setLoading(false);
    }
    load();
  }, [date]);

  const stats = useMemo(() => {
    const revenue = orders.reduce((s, o) => s + Number(o.total), 0);
    const orderCount = orders.length;
    const avg = orderCount > 0 ? revenue / orderCount : 0;

    const orderIds = new Set(orders.map((o) => o.id));
    const dayItems = items.filter((i) => orderIds.has(i.order_id));

    const voids = items.filter((i) => i.voided_at);
    const voidValue = voids.reduce((s, i) => s + Number(i.price_at_time) * i.qty, 0);

    const methodMap = new Map<string, number>();
    for (const o of orders) {
      const m = o.payment_method || 'unknown';
      methodMap.set(m, (methodMap.get(m) ?? 0) + Number(o.total));
    }

    const sellerMap = new Map<string, { qty: number; revenue: number }>();
    for (const i of dayItems) {
      if (i.voided_at) continue;
      const cur = sellerMap.get(i.name_snapshot) ?? { qty: 0, revenue: 0 };
      cur.qty += i.qty;
      cur.revenue += Number(i.price_at_time) * i.qty;
      sellerMap.set(i.name_snapshot, cur);
    }
    const topSellers = [...sellerMap.entries()]
      .sort((a, b) => b[1].qty - a[1].qty)
      .slice(0, 15);

    return { revenue, orderCount, avg, voids: voids.length, voidValue, methodMap, topSellers };
  }, [orders, items]);

  return (
    <main className="min-h-screen bg-stone-50 p-4 md:p-8">
      <header className="mb-6 flex flex-wrap justify-between items-end gap-3">
        <div>
          <a href="/admin" className="text-sm text-stone-500 hover:text-red-700">
            ← Back to dashboard
          </a>
          <h1 className="text-3xl font-bold text-stone-800">📋 Z-Report</h1>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-stone-600">Business date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 border border-stone-300 rounded"
          />
          <button
            onClick={() => window.print()}
            className="bg-red-700 hover:bg-red-800 text-white font-bold px-4 py-2 rounded text-sm"
          >
            Print
          </button>
        </div>
      </header>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Tile label="Revenue" value={`RM ${stats.revenue.toFixed(2)}`} accent />
            <Tile label="Orders" value={String(stats.orderCount)} />
            <Tile label="Avg order" value={`RM ${stats.avg.toFixed(2)}`} />
            <Tile
              label="Voids"
              value={`${stats.voids} · RM ${stats.voidValue.toFixed(2)}`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white rounded-lg p-6 border border-stone-200">
              <h2 className="text-lg font-bold text-stone-800 mb-4">Payment methods</h2>
              {stats.methodMap.size === 0 ? (
                <p className="text-stone-400 text-sm">No payments recorded for this date.</p>
              ) : (
                <ul className="space-y-3">
                  {[...stats.methodMap.entries()].map(([method, amount]) => {
                    const pct = stats.revenue > 0 ? (amount / stats.revenue) * 100 : 0;
                    return (
                      <li key={method}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-stone-700 capitalize">{method.replace('_', ' ')}</span>
                          <span className="font-mono text-stone-800">RM {amount.toFixed(2)}</span>
                        </div>
                        <div className="h-2 bg-stone-100 rounded overflow-hidden">
                          <div className="h-full bg-red-700" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-6 pt-4 border-t border-stone-200 text-sm text-stone-600 space-y-1">
                <p className="font-bold text-stone-800 mb-2">Cash reconciliation</p>
                <p>Expected in drawer (opening float + cash sales)</p>
                <p className="font-mono text-lg text-stone-800">
                  RM {(stats.methodMap.get('cash') ?? 0).toFixed(2)} + opening float
                </p>
                <p className="text-xs text-stone-400 mt-2">
                  Count the drawer, subtract your opening float — the rest should match this line.
                </p>
              </div>
            </section>

            <section className="bg-white rounded-lg p-6 border border-stone-200">
              <h2 className="text-lg font-bold text-stone-800 mb-4">Top sellers</h2>
              {stats.topSellers.length === 0 ? (
                <p className="text-stone-400 text-sm">No items sold on this date.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-stone-500 border-b border-stone-100">
                      <th className="pb-2 font-normal">Item</th>
                      <th className="pb-2 font-normal text-right">Qty</th>
                      <th className="pb-2 font-normal text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topSellers.map(([name, s]) => (
                      <tr key={name} className="border-b border-stone-50 last:border-0">
                        <td className="py-2 text-stone-800">{name}</td>
                        <td className="py-2 text-right font-mono">{s.qty}</td>
                        <td className="py-2 text-right font-mono text-red-700">
                          RM {s.revenue.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <p className="mt-8 text-xs text-stone-400 text-center">
            Report generated {new Date().toLocaleString('en-MY')}
          </p>
        </>
      )}
    </main>
  );
}

function todayISO() {
  const d = new Date();
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg p-4 border ${
        accent
          ? 'bg-red-700 text-white border-red-800'
          : 'bg-white text-stone-800 border-stone-200'
      }`}
    >
      <p
        className={`text-xs uppercase tracking-wider ${
          accent ? 'text-red-100' : 'text-stone-500'
        }`}
      >
        {label}
      </p>
      <p className="text-2xl font-bold font-mono mt-1">{value}</p>
    </div>
  );
}
