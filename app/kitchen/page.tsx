'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type OrderItem = {
  id: number;
  order_id: number;
  name_snapshot: string;
  qty: number;
  kitchen_status: string;
};

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

  // Load open orders + subscribe to changes
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
      const { data: itemRows } = await supabase
        .from('order_items')
        .select('*')
        .in('order_id', orderIds);

      if (!mounted) return;

      const combined: Order[] = orderRows.map((o) => ({
        ...o,
        items: (itemRows ?? []).filter((i) => i.order_id === o.id),
      }));
      setOrders(combined);
      setLoading(false);
    }

    loadOrders();

    // Realtime: any change to orders or order_items → reload
    const channel = supabase
      .channel('kitchen')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => loadOrders()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        () => loadOrders()
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  async function markItem(itemId: number, newStatus: string) {
    await supabase
      .from('order_items')
      .update({ kitchen_status: newStatus })
      .eq('id', itemId);
  }

  async function closeOrder(orderId: number) {
    await supabase.from('orders').update({ status: 'closed' }).eq('id', orderId);
  }

  function timeAgo(iso: string) {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
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
            order.items.length > 0 &&
            order.items.every((i) => i.kitchen_status === 'served');

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

              <ul className="space-y-2 mb-3">
                {order.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex justify-between items-center"
                  >
                    <span className="flex-1">
                      <span className="font-mono text-amber-400">
                        {item.qty}x
                      </span>{' '}
                      {item.name_snapshot}
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
                      className={`text-xs px-2 py-1 rounded font-mono uppercase ${
                        item.kitchen_status === 'served'
                          ? 'bg-green-600'
                          : item.kitchen_status === 'cooking'
                          ? 'bg-amber-600'
                          : 'bg-stone-600'
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
