'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminPageHeader } from '@/components/ui';
import { fetchShiftForDate, type Shift } from '@/lib/shifts';

type OrderRow = {
  id: number;
  total: number;
  payment_method: string | null;
  paid_at: string | null;
  status: string;
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
  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const dayStart = new Date(date + 'T00:00:00');
      const dayEnd = new Date(date + 'T23:59:59.999');
      const [ordersRes, itemsRes, shiftRes] = await Promise.all([
        supabase
          .from('orders')
          .select('id, total, payment_method, paid_at, status')
          .not('paid_at', 'is', null)
          .gte('paid_at', dayStart.toISOString())
          .lte('paid_at', dayEnd.toISOString()),
        supabase
          .from('order_items')
          .select('order_id, name_snapshot, qty, price_at_time, voided_at')
          .gte('created_at', dayStart.toISOString())
          .lte('created_at', dayEnd.toISOString()),
        fetchShiftForDate(date),
      ]);
      setOrders((ordersRes.data ?? []) as OrderRow[]);
      setItems((itemsRes.data ?? []) as ItemRow[]);
      setShift(shiftRes);
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
    const topSellers = [...sellerMap.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 15);

    return { revenue, orderCount, avg, voids: voids.length, voidValue, methodMap, topSellers };
  }, [orders, items]);

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1200px] mx-auto px-4 md:px-6 py-6">
      <AdminPageHeader
        title="Z-Report"
        titleZh="日結"
        right={
          <div className="flex items-center gap-2 no-print">
            <label className="text-xs uppercase tracking-widest text-[var(--ink-500)] font-semibold">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
            <button
              onClick={() => window.print()}
              className="text-white font-bold px-4 py-2 rounded-xl text-sm"
              style={{
                background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
                boxShadow: 'var(--shadow-brand)',
              }}
            >
              🖨 Print
            </button>
          </div>
        }
      />

      {loading ? (
        <p className="text-[var(--ink-500)]">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Tile label="Revenue" value={`RM ${stats.revenue.toFixed(2)}`} accent />
            <Tile label="Orders" value={String(stats.orderCount)} />
            <Tile label="Avg order" value={`RM ${stats.avg.toFixed(2)}`} />
            <Tile label="Voids" value={`${stats.voids} · RM ${stats.voidValue.toFixed(2)}`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white rounded-3xl p-6 border border-[var(--ink-200)]" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <h2 className="text-lg font-bold text-[var(--ink-900)] mb-5">Payment methods</h2>
              {stats.methodMap.size === 0 ? (
                <p className="text-[var(--ink-400)] text-sm text-center py-8">
                  No payments recorded for this date.
                </p>
              ) : (
                <ul className="space-y-4">
                  {[...stats.methodMap.entries()].map(([method, amount]) => {
                    const pct = stats.revenue > 0 ? (amount / stats.revenue) * 100 : 0;
                    return (
                      <li key={method}>
                        <div className="flex justify-between text-sm mb-1.5">
                          <span className="text-[var(--ink-700)] capitalize font-semibold">
                            {method.replace('_', ' ')}
                          </span>
                          <span className="font-mono text-[var(--ink-800)]">
                            RM {amount.toFixed(2)}
                            <span className="text-[var(--ink-400)] text-xs ml-2">{pct.toFixed(0)}%</span>
                          </span>
                        </div>
                        <div className="h-2.5 bg-[var(--ink-100)] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: 'linear-gradient(90deg, var(--brand-500), var(--brand-700))',
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <ReconciliationBlock shift={shift} cashSales={stats.methodMap.get('cash') ?? 0} />
            </section>

            <section className="bg-white rounded-3xl p-6 border border-[var(--ink-200)]" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <h2 className="text-lg font-bold text-[var(--ink-900)] mb-5">Top sellers</h2>
              {stats.topSellers.length === 0 ? (
                <p className="text-[var(--ink-400)] text-sm text-center py-8">
                  No items sold on this date.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--ink-500)] border-b border-[var(--ink-100)]">
                      <th className="pb-3 font-normal text-xs uppercase tracking-widest">Item</th>
                      <th className="pb-3 font-normal text-xs uppercase tracking-widest text-right">Qty</th>
                      <th className="pb-3 font-normal text-xs uppercase tracking-widest text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topSellers.map(([name, s], idx) => (
                      <tr key={name} className="border-b border-[var(--ink-100)]/60 last:border-0">
                        <td className="py-2.5 text-[var(--ink-800)]">
                          <span className="inline-flex items-center gap-2">
                            <span className={`w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center ${
                              idx === 0
                                ? 'bg-[var(--gold-400)] text-black'
                                : idx < 3
                                ? 'bg-[var(--brand-100)] text-[var(--brand-700)]'
                                : 'bg-[var(--ink-100)] text-[var(--ink-500)]'
                            }`}>
                              {idx + 1}
                            </span>
                            <span>{name}</span>
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-mono text-[var(--ink-700)]">{s.qty}</td>
                        <td className="py-2.5 text-right font-mono text-[var(--brand-700)] font-semibold">
                          RM {s.revenue.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <p className="mt-8 text-xs text-[var(--ink-400)] text-center">
            Report generated {new Date().toLocaleString('en-MY')}
          </p>
        </>
      )}
    </main>
  );
}

function ReconciliationBlock({ shift, cashSales }: { shift: Shift | null; cashSales: number }) {
  if (!shift) {
    return (
      <div
        className="mt-6 p-4 rounded-2xl"
        style={{
          background: 'linear-gradient(135deg, var(--cream-100), var(--cream-200))',
        }}
      >
        <p className="text-[10px] uppercase tracking-widest text-[var(--ink-500)] font-semibold mb-1">
          Cash reconciliation
        </p>
        <p className="text-xs text-[var(--ink-500)] mb-2">Cash sales this day</p>
        <p className="text-2xl font-mono font-bold text-[var(--ink-800)]">
          RM {cashSales.toFixed(2)}
        </p>
        <p className="text-[10px] text-[var(--ink-500)] mt-2 leading-relaxed">
          No shift was opened for this date. Open a shift in the Cashier page to
          track opening float and drawer variance.
        </p>
      </div>
    );
  }

  const openingFloat = Number(shift.opening_float);
  const expected = openingFloat + cashSales;
  const counted = shift.closing_count != null ? Number(shift.closing_count) : null;
  const variance = counted != null ? counted - expected : null;
  const good = variance != null && Math.abs(variance) < 0.05;

  return (
    <div
      className="mt-6 p-4 rounded-2xl space-y-1 text-sm"
      style={{
        background: 'linear-gradient(135deg, var(--cream-100), var(--cream-200))',
      }}
    >
      <p className="text-[10px] uppercase tracking-widest text-[var(--ink-500)] font-semibold mb-2">
        Cash reconciliation
      </p>
      <ReconRow label={`Opening float · ${shift.opened_by ?? '—'}`} value={openingFloat} />
      <ReconRow label="Cash sales" value={cashSales} />
      <div className="flex justify-between font-bold text-[var(--ink-900)] border-t border-[var(--cream-300)] pt-1 mt-1">
        <span>Expected in drawer</span>
        <span className="font-mono">RM {expected.toFixed(2)}</span>
      </div>
      {counted != null && (
        <>
          <ReconRow label="Counted" value={counted} />
          <div
            className={`flex justify-between font-bold rounded-lg px-2 py-1 mt-1 ${
              good
                ? 'bg-[var(--jade-100)] text-[var(--jade-600)]'
                : 'bg-[var(--brand-50)] text-[var(--brand-700)]'
            }`}
          >
            <span>Variance</span>
            <span className="font-mono">
              {(variance ?? 0) > 0 ? '+' : ''}RM {(variance ?? 0).toFixed(2)}
            </span>
          </div>
          {shift.notes && (
            <p className="text-[10px] text-[var(--ink-500)] mt-1">Note: {shift.notes}</p>
          )}
        </>
      )}
      {counted == null && (
        <p className="text-[10px] text-[var(--ink-500)] mt-2 leading-relaxed">
          Shift not yet closed. Close the shift from the Cashier page at end of day.
        </p>
      )}
    </div>
  );
}

function ReconRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-[var(--ink-600)]">
      <span>{label}</span>
      <span className="font-mono">RM {value.toFixed(2)}</span>
    </div>
  );
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-3xl p-5 ${accent ? 'text-white' : 'bg-white text-[var(--ink-900)] border border-[var(--ink-200)]'}`}
      style={
        accent
          ? {
              background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
              boxShadow: 'var(--shadow-brand)',
            }
          : { boxShadow: 'var(--shadow-sm)' }
      }
    >
      <p className={`text-[10px] uppercase tracking-[0.2em] ${accent ? 'text-white/70' : 'text-[var(--ink-500)]'} font-semibold`}>
        {label}
      </p>
      <p className="text-2xl font-bold font-mono mt-2 leading-none">{value}</p>
    </div>
  );
}
