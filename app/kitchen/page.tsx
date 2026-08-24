'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { OrderItem } from '@/lib/types';

type Order = {
  id: number;
  table_number: number;
  status: string;
  created_at: string;
  items: OrderItem[];
};

export default function KitchenPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  // A tick that re-renders the whole page every 30s so "time ago"
  // stays fresh without touching Date.now() during render.
  const [nowTick, setNowTick] = useState<number>(0);

  useEffect(() => {
    setNowTick(Date.now());
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadOrders() {
      const { data: orderRows } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: true });

      if (!orderRows) return;
      const orderIds = orderRows.map((o) => o.id);
      const { data: itemRows } = orderIds.length
        ? await supabase.from('order_items').select('*').in('order_id', orderIds)
        : { data: [] as OrderItem[] };
      if (!mounted) return;

      const combined: Order[] = orderRows.map((o) => ({
        ...o,
        items: ((itemRows ?? []) as OrderItem[])
          .filter((i) => i.order_id === o.id && !i.voided_at)
          .sort((a, b) => a.id - b.id),
      }));
      setOrders(combined);
      setLoading(false);
    }

    loadOrders();

    const channel = supabase
      .channel('kitchen')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => loadOrders())
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  async function markItem(itemId: number, newStatus: string) {
    await supabase.from('order_items').update({ kitchen_status: newStatus }).eq('id', itemId);
  }

  async function closeOrder(orderId: number) {
    await supabase.from('orders').update({ status: 'closed' }).eq('id', orderId);
  }

  function timeAgo(iso: string) {
    if (!nowTick) return '';
    const mins = Math.floor((nowTick - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 min ago';
    return `${mins} mins ago`;
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-900 text-white p-6">
        <p>Loading kitchen…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-900 text-white p-4 md:p-6">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">👨‍🍳 Kitchen</h1>
        <span className="text-stone-400 text-sm">
          {orders.length} open {orders.length === 1 ? 'order' : 'orders'}
        </span>
      </header>

      {orders.length === 0 && (
        <div className="text-center text-stone-500 mt-20">
          <p className="text-xl">No open orders</p>
          <p className="text-sm mt-2">New orders will appear here automatically.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {orders.map((order) => {
          const allServed =
            order.items.length > 0 && order.items.every((i) => i.kitchen_status === 'served');

          return (
            <div
              key={order.id}
              className={`rounded-lg p-4 border-2 ${
                allServed
                  ? 'bg-green-900/30 border-green-600'
                  : 'bg-stone-800 border-stone-700'
              }`}
            >
              <div className="flex justify-between items-baseline mb-3">
                <h2 className="text-2xl font-bold">Table {order.table_number}</h2>
                <span className="text-xs text-stone-400 font-mono">
                  #{order.id} · {timeAgo(order.created_at)}
                </span>
              </div>

              {order.items.length === 0 && (
                <p className="text-sm text-stone-500 italic">
                  All items voided or served.
                </p>
              )}

              <ul className="space-y-2 mb-3">
                {order.items.map((item) => (
                  <li key={item.id} className="flex justify-between items-center gap-2">
                    <span className="flex-1 min-w-0">
                      <span className="font-mono text-amber-400">{item.qty}x</span>{' '}
                      <span className="font-bold">{item.name_snapshot}</span>
                      {item.name_zh_snapshot && (
                        <span className="text-stone-400 block text-sm ml-6">
                          {item.name_zh_snapshot}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() =>
                        markItem(
                          item.id,
                          item.kitchen_status === 'pending'
                            ? 'cooking'
                            : item.kitchen_status === 'cooking'
                            ? 'served'
                            : 'pending'
                        )
                      }
                      className={`text-xs px-3 py-2 rounded font-mono uppercase font-bold shrink-0 ${
                        item.kitchen_status === 'served'
                          ? 'bg-green-600'
                          : item.kitchen_status === 'cooking'
                          ? 'bg-amber-600'
                          : 'bg-stone-600 hover:bg-stone-500'
                      }`}
                    >
                      {item.kitchen_status}
                    </button>
                  </li>
                ))}
              </ul>

              {allServed && (
                <button
                  onClick={() => closeOrder(order.id)}
                  className="w-full mt-2 bg-green-700 hover:bg-green-600 text-white font-bold py-2 rounded"
                >
                  Close Order
                </button>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
