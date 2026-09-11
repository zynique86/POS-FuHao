'use client';

// Live-updating "Today at a glance" dashboard.
// Fetches on mount, then re-fetches whenever orders / order_items /
// payments change via Supabase Realtime so numbers pulse in real time.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type OrderRow = {
  id: number;
  table_number: number;
  total: number;
  subtotal: number | null;
  payment_method: string | null;
  paid_at: string | null;
  created_at: string;
  status: string;
};
type ItemRow = {
  order_id: number;
  name_snapshot: string;
  qty: number;
  price_at_time: number;
  voided_at: string | null;
};
type PaymentRow = {
  method: string;
  amount: number;
  created_at: string;
};

export default function Dashboard() {
  const [todayOrders, setTodayOrders] = useState<OrderRow[]>([]);
  const [yestOrders, setYestOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [openOrders, setOpenOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulse, setPulse] = useState(0);

  async function loadAll() {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const yestStart = new Date(todayStart);
    yestStart.setDate(yestStart.getDate() - 1);

    const [todayRes, yestRes, itemsRes, paysRes, openRes] = await Promise.all([
      supabase.from('orders').select('*').gte('paid_at', todayStart.toISOString()),
      supabase.from('orders').select('*').gte('paid_at', yestStart.toISOString()).lt('paid_at', todayStart.toISOString()),
      supabase.from('order_items').select('order_id, name_snapshot, qty, price_at_time, voided_at').gte('created_at', todayStart.toISOString()),
      supabase.from('payments').select('method, amount, created_at').gte('created_at', todayStart.toISOString()),
      supabase.from('orders').select('*').is('paid_at', null),
    ]);

    setTodayOrders((todayRes.data ?? []) as OrderRow[]);
    setYestOrders((yestRes.data ?? []) as OrderRow[]);
    setItems((itemsRes.data ?? []) as ItemRow[]);
    setPayments((paysRes.data ?? []) as PaymentRow[]);
    setOpenOrders((openRes.data ?? []) as OrderRow[]);
    setLoading(false);
    setPulse((p) => p + 1);
  }

  useEffect(() => {
    loadAll();
    const channel = supabase
      .channel('admin-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => loadAll())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const stats = useMemo(() => computeStats({ todayOrders, yestOrders, items, payments, openOrders }), [
    todayOrders,
    yestOrders,
    items,
    payments,
    openOrders,
  ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-[var(--ink-500)]">
        Loading dashboard…
      </div>
    );
  }

  return (
    <div>
      {/* HERO — today's revenue */}
      <section
        className="relative overflow-hidden rounded-[28px] p-6 md:p-10 mb-8 text-white"
        style={{
          background:
            'linear-gradient(135deg, var(--brand-700) 0%, var(--brand-900) 55%, #2A0505 100%)',
          boxShadow: 'var(--shadow-brand)',
        }}
      >
        {/* decorative rings */}
        <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full"
             style={{ background: 'radial-gradient(circle, rgb(251 191 36 / 0.20), transparent 60%)' }} />
        <div className="pointer-events-none absolute -bottom-32 -left-16 w-96 h-96 rounded-full"
             style={{ background: 'radial-gradient(circle, rgb(255 255 255 / 0.08), transparent 65%)' }} />

        <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 items-end">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--jade-500)] opacity-60 animate-ping" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--jade-500)]" />
              </span>
              <span className="text-[10px] uppercase tracking-[0.3em] text-white/70 font-semibold">
                Live · Today
              </span>
            </div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/60">Revenue</p>
            <p key={pulse} className="text-6xl md:text-7xl font-bold font-mono tracking-tight leading-none mt-2 animate-rise">
              RM {stats.revenue.toFixed(2)}
            </p>
            <div className="flex flex-wrap items-baseline gap-6 mt-5">
              <ComparisonDelta today={stats.revenue} yesterday={stats.yestRevenue} label="vs. yesterday" />
              <MiniStat label="Orders" value={String(stats.orderCount)} />
              <MiniStat label="Avg order" value={`RM ${stats.avgOrder.toFixed(2)}`} />
            </div>
          </div>

          {/* Right side: hour bars mini */}
          <div className="hidden lg:block">
            <p className="text-[10px] uppercase tracking-[0.25em] text-white/60 mb-3 text-right">
              Hourly · Peak {stats.peakHour !== null ? `${stats.peakHour}:00` : '—'}
            </p>
            <div className="flex items-end gap-1 h-24 w-[320px]">
              {stats.hourly.map((v, h) => {
                const pct = (v / Math.max(stats.hourlyMax, 1)) * 100;
                const isPeak = h === stats.peakHour && v > 0;
                return (
                  <div key={h} className="flex-1 flex items-end">
                    <div
                      className="w-full rounded-t transition-all"
                      style={{
                        height: `${Math.max(pct, v > 0 ? 6 : 2)}%`,
                        background: isPeak
                          ? 'linear-gradient(180deg, var(--gold-300), var(--gold-500))'
                          : 'rgb(255 255 255 / 0.35)',
                      }}
                      title={`${h}:00 — RM ${v.toFixed(2)}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* SECONDARY STATS — 6 tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <MiniTile emoji="🧾" label="Orders paid" value={String(stats.orderCount)} accent="brand" />
        <MiniTile emoji="🥟" label="Items sold" value={String(stats.itemsSold)} accent="gold" />
        <MiniTile emoji="⏳" label="Unpaid now" value={String(stats.openCount)} accent="brand" pulse={stats.openCount > 0} />
        <MiniTile emoji="🕒" label="Peak hour" value={stats.peakHour !== null ? `${stats.peakHour}:00` : '—'} />
        <MiniTile emoji="🍽" label="Avg / order" value={`${stats.avgItems.toFixed(1)} items`} />
        <MiniTile
          emoji="🚫"
          label="Voids"
          value={`${stats.voidCount} · ${stats.voidValue > 0 ? `RM ${stats.voidValue.toFixed(0)}` : '—'}`}
          accent={stats.voidCount > 0 ? 'warn' : undefined}
        />
      </div>

      {/* CHARTS ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Hourly chart — big */}
        <section className="lg:col-span-2 bg-white rounded-[28px] p-6 md:p-8 border border-[var(--ink-200)]"
                 style={{ boxShadow: 'var(--shadow-md)' }}>
          <SectionHead
            title="Revenue by hour"
            sub="Today"
            right={stats.peakHour !== null ? `Peak ${stats.peakHour}:00 · RM ${stats.hourlyMax.toFixed(2)}` : ''}
          />
          {stats.orderCount === 0 ? (
            <EmptyBlock label="No sales yet today." emoji="📈" />
          ) : (
            <div className="flex items-end gap-1.5 h-72 mt-4">
              {stats.hourly.map((val, h) => {
                const pct = (val / Math.max(stats.hourlyMax, 1)) * 100;
                const isPeak = h === stats.peakHour && val > 0;
                return (
                  <div key={h} className="flex-1 flex flex-col items-center gap-1.5 min-w-0 group">
                    <div className="text-[10px] font-mono text-[var(--ink-400)] opacity-0 group-hover:opacity-100 transition h-4">
                      {val > 0 ? `RM ${val.toFixed(0)}` : ''}
                    </div>
                    <div className="w-full flex items-end h-60">
                      <div
                        className="w-full rounded-t-lg transition-all group-hover:scale-y-105 origin-bottom"
                        style={{
                          height: `${Math.max(pct, val > 0 ? 4 : 0)}%`,
                          background: isPeak
                            ? 'linear-gradient(180deg, var(--gold-400), var(--brand-600))'
                            : 'linear-gradient(180deg, var(--brand-400), var(--brand-700))',
                          opacity: val === 0 ? 0.10 : 1,
                          boxShadow: isPeak ? '0 8px 20px -4px rgb(217 119 6 / 0.4)' : undefined,
                        }}
                        title={`${h}:00 — RM ${val.toFixed(2)}`}
                      />
                    </div>
                    <span className={`text-[10px] font-mono ${isPeak ? 'text-[var(--brand-700)] font-bold' : 'text-[var(--ink-400)]'}`}>
                      {h}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Payment methods */}
        <section className="bg-white rounded-[28px] p-6 md:p-8 border border-[var(--ink-200)]"
                 style={{ boxShadow: 'var(--shadow-md)' }}>
          <SectionHead title="Payment methods" sub="Today" />
          {stats.methodList.length === 0 ? (
            <EmptyBlock label="No payments yet." emoji="💳" />
          ) : (
            <>
              {/* Donut */}
              <div className="flex justify-center my-4">
                <DonutChart segments={stats.methodList} total={stats.revenue} />
              </div>
              <ul className="space-y-3">
                {stats.methodList.map((m) => {
                  const pct = stats.revenue > 0 ? (m.amount / stats.revenue) * 100 : 0;
                  return (
                    <li key={m.method} className="flex items-center gap-3">
                      <span className="w-3 h-3 rounded-full" style={{ background: m.color }} />
                      <span className="text-sm text-[var(--ink-700)] capitalize flex-1">
                        {m.method.replace('_', ' ')}
                      </span>
                      <span className="text-sm font-mono text-[var(--ink-800)] font-semibold">
                        RM {m.amount.toFixed(2)}
                      </span>
                      <span className="text-xs text-[var(--ink-400)] w-10 text-right font-mono">
                        {pct.toFixed(0)}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </div>

      {/* BEST SELLERS + LIVE ORDERS */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <section className="lg:col-span-3 bg-white rounded-[28px] p-6 md:p-8 border border-[var(--ink-200)]"
                 style={{ boxShadow: 'var(--shadow-md)' }}>
          <SectionHead title="Best sellers" sub="Today · Top 10" />
          {stats.bestSellers.length === 0 ? (
            <EmptyBlock label="No items sold yet." emoji="🥟" />
          ) : (
            <ul className="space-y-3 mt-4">
              {stats.bestSellers.map(([name, s], idx) => {
                const pct = stats.bestMax > 0 ? (s.qty / stats.bestMax) * 100 : 0;
                return (
                  <li key={name} className="grid grid-cols-[36px_1fr_auto] items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${
                        idx === 0
                          ? 'text-black'
                          : idx < 3
                          ? 'text-[var(--brand-700)]'
                          : 'text-[var(--ink-500)]'
                      }`}
                      style={{
                        background:
                          idx === 0
                            ? 'linear-gradient(135deg, var(--gold-300), var(--gold-500))'
                            : idx < 3
                            ? 'var(--brand-100)'
                            : 'var(--ink-100)',
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="font-semibold text-[var(--ink-900)] truncate">{name}</span>
                        <span className="text-xs text-[var(--ink-400)] font-mono shrink-0 ml-2">
                          {s.qty} sold
                        </span>
                      </div>
                      <div className="h-2 bg-[var(--ink-100)] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            background:
                              'linear-gradient(90deg, var(--brand-500), var(--brand-700))',
                          }}
                        />
                      </div>
                    </div>
                    <span className="font-mono text-sm font-bold text-[var(--brand-700)]">
                      RM {s.revenue.toFixed(2)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="lg:col-span-2 bg-white rounded-[28px] p-6 md:p-8 border border-[var(--ink-200)]"
                 style={{ boxShadow: 'var(--shadow-md)' }}>
          <SectionHead title="Live orders" sub={`${openOrders.length} open`} />
          {openOrders.length === 0 ? (
            <EmptyBlock label="No open orders — nice and calm." emoji="🫖" />
          ) : (
            <ul className="space-y-2 mt-4 max-h-[420px] overflow-y-auto -mr-2 pr-2">
              {[...openOrders]
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                .map((o) => {
                  const mins = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 60000);
                  const isOld = mins >= 15;
                  return (
                    <li
                      key={o.id}
                      className={`flex items-center gap-3 rounded-2xl p-3 ${
                        isOld ? 'bg-[var(--brand-50)]' : 'bg-[var(--cream-100)]'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold"
                           style={{
                             background: isOld
                               ? 'linear-gradient(135deg, var(--brand-500), var(--brand-700))'
                               : 'linear-gradient(135deg, var(--gold-400), var(--gold-600))',
                           }}>
                        {o.table_number}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--ink-900)]">
                          Table {o.table_number}
                          <span className="ml-2 text-[10px] text-[var(--ink-400)] font-mono">#{o.id}</span>
                        </p>
                        <p className={`text-xs ${isOld ? 'text-[var(--brand-700)] font-semibold' : 'text-[var(--ink-500)]'}`}>
                          {mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : `${mins} min ago`}
                        </p>
                      </div>
                      <span className="font-mono text-sm font-bold text-[var(--brand-700)]">
                        RM {Number(o.total).toFixed(2)}
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── stat helpers ─────────────────────────────────────────────────────────

function computeStats({
  todayOrders,
  yestOrders,
  items,
  payments,
  openOrders,
}: {
  todayOrders: OrderRow[];
  yestOrders: OrderRow[];
  items: ItemRow[];
  payments: PaymentRow[];
  openOrders: OrderRow[];
}) {
  const revenue = todayOrders.reduce((s, o) => s + Number(o.total), 0);
  const yestRevenue = yestOrders.reduce((s, o) => s + Number(o.total), 0);
  const orderCount = todayOrders.length;
  const avgOrder = orderCount > 0 ? revenue / orderCount : 0;

  const todayIds = new Set(todayOrders.map((o) => o.id));
  const todayItems = items.filter((i) => todayIds.has(i.order_id));

  const soldItems = todayItems.filter((i) => !i.voided_at);
  const itemsSold = soldItems.reduce((s, i) => s + i.qty, 0);
  const voids = items.filter((i) => i.voided_at);
  const voidCount = voids.length;
  const voidValue = voids.reduce((s, i) => s + Number(i.price_at_time) * i.qty, 0);
  const avgItems = orderCount > 0 ? itemsSold / orderCount : 0;

  const hourly = Array(24).fill(0);
  for (const o of todayOrders) {
    if (o.paid_at) {
      const h = new Date(o.paid_at).getHours();
      hourly[h] += Number(o.total);
    }
  }
  const hourlyMax = Math.max(...hourly, 0);
  const peakHour = hourlyMax > 0 ? hourly.indexOf(hourlyMax) : null;

  // Payment methods — assign stable colours
  const METHOD_COLORS: Record<string, string> = {
    cash: 'var(--brand-600)',
    duitnow_qr: 'var(--gold-500)',
    card: 'var(--jade-500)',
    unknown: 'var(--ink-400)',
  };
  const methodMap = new Map<string, number>();
  for (const p of payments) {
    methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + Number(p.amount));
  }
  const methodList = [...methodMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([method, amount]) => ({
      method,
      amount,
      color: METHOD_COLORS[method] ?? 'var(--ink-500)',
    }));

  // Best sellers
  const sellerMap = new Map<string, { qty: number; revenue: number }>();
  for (const i of todayItems) {
    if (i.voided_at) continue;
    const cur = sellerMap.get(i.name_snapshot) ?? { qty: 0, revenue: 0 };
    cur.qty += i.qty;
    cur.revenue += Number(i.price_at_time) * i.qty;
    sellerMap.set(i.name_snapshot, cur);
  }
  const bestSellers = [...sellerMap.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 10);
  const bestMax = bestSellers[0]?.[1].qty ?? 0;

  return {
    revenue,
    yestRevenue,
    orderCount,
    avgOrder,
    itemsSold,
    voidCount,
    voidValue,
    avgItems,
    hourly,
    hourlyMax,
    peakHour,
    methodList,
    bestSellers,
    bestMax,
    openCount: openOrders.length,
  };
}

// ─── little components ───────────────────────────────────────────────────

function SectionHead({ title, sub, right }: { title: string; sub?: string; right?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h2 className="text-lg md:text-xl font-bold text-[var(--ink-900)]">{title}</h2>
        {sub && <p className="text-xs text-[var(--ink-400)] mt-0.5">{sub}</p>}
      </div>
      {right && (
        <span className="text-xs font-semibold text-[var(--brand-700)] font-mono">
          {right}
        </span>
      )}
    </div>
  );
}

function EmptyBlock({ label, emoji }: { label: string; emoji: string }) {
  return (
    <div className="text-center py-12 text-[var(--ink-400)] text-sm">
      <div className="text-4xl mb-2 opacity-40">{emoji}</div>
      {label}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/60">{label}</p>
      <p className="text-lg font-bold font-mono mt-0.5">{value}</p>
    </div>
  );
}

function ComparisonDelta({
  today,
  yesterday,
  label,
}: {
  today: number;
  yesterday: number;
  label: string;
}) {
  if (yesterday === 0) {
    return (
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/60">{label}</p>
        <p className="text-lg font-bold text-white/70 mt-0.5">—</p>
      </div>
    );
  }
  const delta = today - yesterday;
  const pct = (delta / yesterday) * 100;
  const positive = delta >= 0;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/60">{label}</p>
      <p
        className="text-lg font-bold font-mono mt-0.5 inline-flex items-center gap-1.5"
        style={{ color: positive ? '#86EFAC' : '#FCA5A5' }}
      >
        <span>{positive ? '▲' : '▼'}</span>
        <span>{Math.abs(pct).toFixed(1)}%</span>
        <span className="text-white/50 text-xs font-sans font-normal">
          (RM {Math.abs(delta).toFixed(0)})
        </span>
      </p>
    </div>
  );
}

function MiniTile({
  emoji,
  label,
  value,
  accent,
  pulse,
}: {
  emoji: string;
  label: string;
  value: string;
  accent?: 'brand' | 'gold' | 'warn' | 'jade';
  pulse?: boolean;
}) {
  const bg =
    accent === 'brand'
      ? 'linear-gradient(135deg, var(--brand-50), #FFFFFF)'
      : accent === 'gold'
      ? 'linear-gradient(135deg, rgb(251 191 36 / 0.12), #FFFFFF)'
      : accent === 'warn'
      ? 'linear-gradient(135deg, rgb(234 88 12 / 0.10), #FFFFFF)'
      : accent === 'jade'
      ? 'linear-gradient(135deg, rgb(5 150 105 / 0.10), #FFFFFF)'
      : '#FFFFFF';
  const border =
    accent === 'brand'
      ? 'var(--brand-100)'
      : accent === 'gold'
      ? 'rgb(251 191 36 / 0.3)'
      : accent === 'warn'
      ? 'rgb(234 88 12 / 0.30)'
      : accent === 'jade'
      ? 'rgb(5 150 105 / 0.30)'
      : 'var(--ink-200)';

  return (
    <div
      className="rounded-2xl p-4 border relative"
      style={{ background: bg, borderColor: border, boxShadow: 'var(--shadow-sm)' }}
    >
      {pulse && (
        <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--brand-500)] opacity-50 animate-ping" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--brand-500)]" />
        </span>
      )}
      <div className="text-xl mb-2">{emoji}</div>
      <p className="text-[10px] uppercase tracking-widest text-[var(--ink-500)] font-semibold">
        {label}
      </p>
      <p className="text-xl md:text-2xl font-bold font-mono text-[var(--ink-900)] mt-1 leading-tight">
        {value}
      </p>
    </div>
  );
}

// ─── donut chart ─────────────────────────────────────────────────────────

function DonutChart({
  segments,
  total,
}: {
  segments: { method: string; amount: number; color: string }[];
  total: number;
}) {
  const size = 180;
  const stroke = 30;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  let offset = 0;
  const arcs = segments.map((seg) => {
    const pct = total > 0 ? seg.amount / total : 0;
    const len = pct * c;
    const el = (
      <circle
        key={seg.method}
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={seg.color}
        strokeWidth={stroke}
        strokeDasharray={`${len} ${c - len}`}
        strokeDashoffset={-offset}
        strokeLinecap="butt"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 300ms ease' }}
      />
    );
    offset += len;
    return el;
  });

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ink-100)"
          strokeWidth={stroke}
        />
        {arcs}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[10px] uppercase tracking-widest text-[var(--ink-500)] font-semibold">
          Total
        </span>
        <span className="text-lg font-bold font-mono text-[var(--ink-900)]">
          RM {total.toFixed(0)}
        </span>
      </div>
    </div>
  );
}
