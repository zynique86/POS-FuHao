'use client';

// Shared station display used by both /kitchen and /bar.
// Filters the open orders + restock queue to only show items for the
// station this device is watching.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fulfillRestock, listPendingRestock } from '@/lib/restock';
import type { OrderItem, RestockRequest, PrintStation } from '@/lib/types';

type OrderRow = {
  id: number;
  table_number: number;
  status: string;
  created_at: string;
};
type OrderWithItems = OrderRow & { items: OrderItem[] };

export default function StationDisplay({
  station,
  title,
  titleZh,
  emoji,
}: {
  station: PrintStation;
  title: string;
  titleZh: string;
  emoji: string;
}) {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowTick, setNowTick] = useState<number>(0);
  const [restocks, setRestocks] = useState<RestockRequest[]>([]);
  const [menuStationById, setMenuStationById] = useState<Map<number, PrintStation>>(new Map());

  // "Time ago" ticker.
  useEffect(() => {
    setNowTick(Date.now());
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Menu station map — needed to filter order items to just this station.
  useEffect(() => {
    async function loadMenu() {
      const { data } = await supabase.from('menu_items').select('id, station');
      const m = new Map<number, PrintStation>();
      (data ?? []).forEach((r) => m.set(r.id as number, r.station as PrintStation));
      setMenuStationById(m);
    }
    loadMenu();
    const ch = supabase
      .channel(`station-menu-${station}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => loadMenu())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [station]);

  // Orders — filtered client-side to just this station's items.
  useEffect(() => {
    let mounted = true;
    async function load() {
      const { data: orderRows } = await supabase
        .from('orders')
        .select('id, table_number, status, created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: true });
      if (!orderRows) return;
      const ids = orderRows.map((o) => o.id);
      const { data: itemRows } = ids.length
        ? await supabase.from('order_items').select('*').in('order_id', ids)
        : { data: [] as OrderItem[] };
      if (!mounted) return;

      const combined: OrderWithItems[] = (orderRows as OrderRow[])
        .map((o) => ({
          ...o,
          items: ((itemRows ?? []) as OrderItem[])
            .filter((i) => i.order_id === o.id && !i.voided_at)
            .filter((i) => {
              const st = i.menu_item_id != null ? menuStationById.get(i.menu_item_id) : undefined;
              return (st ?? 'kitchen') === station;
            })
            .sort((a, b) => a.id - b.id),
        }))
        // Hide orders that have nothing for us to prepare.
        .filter((o) => o.items.length > 0);
      setOrders(combined);
      setLoading(false);
    }
    load();
    const channel = supabase
      .channel(`station-orders-${station}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => load())
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [station, menuStationById]);

  // Restock queue for this station only.
  useEffect(() => {
    async function loadR() {
      const all = await listPendingRestock();
      setRestocks(
        all.filter((r) => {
          const st = menuStationById.get(r.menu_item_id) ?? 'kitchen';
          return st === station;
        })
      );
    }
    loadR();
    const channel = supabase
      .channel(`station-restock-${station}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restock_requests' }, () => loadR())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [station, menuStationById]);

  async function markItem(itemId: number, status: string) {
    await supabase.from('order_items').update({ kitchen_status: status }).eq('id', itemId);
  }
  async function closeOrder(id: number) {
    await supabase.from('orders').update({ status: 'closed' }).eq('id', id);
  }
  async function markRestockDone(id: number) {
    const { data: userRes } = await supabase.auth.getUser();
    const by = userRes?.user?.email ?? station;
    await fulfillRestock(id, by);
  }

  function ageMinutes(iso: string) {
    if (!nowTick) return 0;
    return Math.floor((nowTick - new Date(iso).getTime()) / 60000);
  }

  // Colour theme differs per station so a glance at the tablet tells you
  // which surface you're on.
  const theme = useMemo(
    () =>
      station === 'bar'
        ? {
            bg: 'radial-gradient(1200px 500px at 10% 0%, rgb(5 150 105 / 0.20), transparent 60%), radial-gradient(900px 500px at 100% 100%, rgb(217 119 6 / 0.15), transparent 60%), #0F1917',
            accent: 'var(--gold-400)',
            headerBg:
              'linear-gradient(90deg, var(--jade-600), transparent)',
          }
        : {
            bg: 'radial-gradient(1200px 500px at 10% 0%, rgb(180 83 9 / 0.20), transparent 60%), radial-gradient(900px 500px at 100% 100%, rgb(220 38 38 / 0.15), transparent 60%), #1C1917',
            accent: 'var(--gold-400)',
            headerBg: 'linear-gradient(90deg, var(--ink-800), transparent)',
          },
    [station]
  );

  return (
    <div
      className="min-h-[calc(100vh-56px)] text-white"
      style={{ background: theme.bg }}
    >
      <main className="max-w-[1600px] mx-auto px-4 md:px-6 py-6">
        <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em]" style={{ color: theme.accent }}>
              {emoji} {title} · {titleZh}
            </p>
            <h1 className="text-3xl md:text-4xl font-bold mt-1">
              {station === 'bar' ? 'Now Serving' : 'Now Cooking'}
            </h1>
            <p className="text-sm text-white/50 mt-1">
              {station === 'bar'
                ? 'Drinks come in here. Tap a status to advance it.'
                : 'Food tickets come in here. Tap a status to advance it.'}
            </p>
          </div>
          <div
            className="rounded-2xl px-4 py-2.5 border"
            style={{ background: 'rgb(255 255 255 / 0.06)', borderColor: 'rgb(255 255 255 / 0.10)' }}
          >
            <p className="text-[10px] uppercase tracking-widest text-white/60">Open orders</p>
            <p className="text-2xl font-bold font-mono">{orders.length}</p>
          </div>
        </header>

        {loading && <p className="text-white/60">Loading…</p>}

        {/* RESTOCK QUEUE */}
        {restocks.length > 0 && (
          <section className="mb-6">
            <div
              className="rounded-2xl overflow-hidden border-2"
              style={{
                borderColor: 'var(--warn-500)',
                background:
                  'linear-gradient(135deg, rgb(234 88 12 / 0.20), rgb(180 83 9 / 0.10))',
                boxShadow: '0 12px 28px -8px rgb(234 88 12 / 0.30)',
              }}
            >
              <div
                className="flex items-center justify-between px-5 py-3"
                style={{
                  background:
                    'linear-gradient(90deg, var(--warn-500), var(--brand-700))',
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-70 animate-ping" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
                  </span>
                  <h2 className="text-lg font-bold uppercase tracking-widest text-white">
                    🔥 Restock queue
                  </h2>
                </div>
                <span className="text-sm font-bold text-white/80 font-mono">
                  {restocks.length}
                </span>
              </div>
              <ul className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {restocks.map((r) => {
                  const mins = ageMinutes(r.requested_at);
                  const old = mins >= 5;
                  return (
                    <li
                      key={r.id}
                      className={`rounded-xl p-4 flex items-center gap-3 ${
                        old ? 'bg-[var(--brand-900)]/60' : 'bg-black/30'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xl font-bold text-white leading-tight">
                          {r.item_name_snapshot}
                        </p>
                        {r.item_name_zh_snapshot && (
                          <p className="text-base text-white/70">
                            {r.item_name_zh_snapshot}
                          </p>
                        )}
                        <p className="text-xs text-white/60 mt-1">
                          {r.qty_wanted ? `${r.qty_wanted} · ` : ''}
                          {mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : `${mins} min ago`}
                        </p>
                        {r.note && (
                          <p className="text-xs mt-1 px-2 py-1 rounded bg-white/10 text-[var(--gold-300)]">
                            {r.note}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => markRestockDone(r.id)}
                        className="shrink-0 text-white font-bold px-4 py-3 rounded-xl"
                        style={{
                          background:
                            'linear-gradient(135deg, var(--jade-500), var(--jade-600))',
                        }}
                      >
                        Done ✓
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        {!loading && orders.length === 0 && restocks.length === 0 && (
          <div className="text-center py-24">
            <div className="text-7xl mb-4 opacity-40">{emoji}</div>
            <p className="text-xl font-semibold text-white/80">No open orders</p>
            <p className="text-sm text-white/40 mt-2">
              New {station} tickets will appear here automatically.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-8">
          {orders.map((order) => {
            const allServed =
              order.items.length > 0 && order.items.every((i) => i.kitchen_status === 'served');
            const age = ageMinutes(order.created_at);
            const isOld = age >= 10;

            return (
              <article
                key={order.id}
                className={`rounded-2xl overflow-hidden border ${
                  allServed
                    ? 'bg-[var(--jade-600)]/25 border-[var(--jade-500)]/60'
                    : isOld
                    ? 'bg-[var(--brand-900)]/40 border-[var(--brand-500)]/60'
                    : 'bg-white/5 border-white/10'
                }`}
                style={{ boxShadow: 'var(--shadow-md)' }}
              >
                <div
                  className="flex items-baseline justify-between px-4 py-3"
                  style={{
                    background: allServed
                      ? 'linear-gradient(90deg, var(--jade-600), transparent)'
                      : isOld
                      ? 'linear-gradient(90deg, var(--brand-700), transparent)'
                      : theme.headerBg,
                  }}
                >
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/60">Table</p>
                    <p className="text-2xl font-bold">{order.table_number}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-mono text-white/60">#{order.id}</p>
                    <p className={`text-xs font-bold ${isOld ? 'text-[var(--brand-200)]' : 'text-white/70'}`}>
                      {age === 0 ? 'just now' : age === 1 ? '1 min' : `${age} min`}
                    </p>
                  </div>
                </div>

                <div className="p-4">
                  <ul className="space-y-2">
                    {order.items.map((item) => {
                      const s = item.kitchen_status;
                      return (
                        <li key={item.id} className="flex justify-between items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="leading-tight">
                              <span className="font-mono text-[var(--gold-400)] font-bold">
                                {item.qty}×
                              </span>{' '}
                              <span className="font-bold">{item.name_snapshot}</span>
                            </p>
                            {item.name_zh_snapshot && (
                              <p className="text-sm text-white/60 ml-6">{item.name_zh_snapshot}</p>
                            )}
                          </div>
                          <button
                            onClick={() =>
                              markItem(
                                item.id,
                                s === 'pending' ? 'cooking' : s === 'cooking' ? 'served' : 'pending'
                              )
                            }
                            className={`text-[10px] px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider shrink-0 ${
                              s === 'served'
                                ? 'bg-[var(--jade-500)] text-white'
                                : s === 'cooking'
                                ? 'bg-[var(--gold-500)] text-black'
                                : 'bg-white/10 hover:bg-white/20 text-white'
                            }`}
                          >
                            {s}
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {allServed && (
                    <button
                      onClick={() => closeOrder(order.id)}
                      className="mt-4 w-full text-white font-bold py-2.5 rounded-xl"
                      style={{
                        background:
                          'linear-gradient(135deg, var(--jade-500), var(--jade-600))',
                      }}
                    >
                      Close order ✓
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}
