'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

type MenuItem = {
  id: number;
  name_en: string;
  name_zh: string | null;
  price: number;
};

type CartLine = {
  item: MenuItem;
  qty: number;
};

export default function POSTerminal({ items }: { items: MenuItem[] }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tableNo, setTableNo] = useState<number>(1);
  const [sending, setSending] = useState(false);
  const [lastOrder, setLastOrder] = useState<number | null>(null);

  // Add one of this item to the cart (or bump qty if it's already there)
  function addToCart(item: MenuItem) {
    setCart((prev) => {
      const existing = prev.find((l) => l.item.id === item.id);
      if (existing) {
        return prev.map((l) =>
          l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l
        );
      }
      return [...prev, { item, qty: 1 }];
    });
  }

  function removeOne(id: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.item.id === id ? { ...l, qty: l.qty - 1 } : l))
        .filter((l) => l.qty > 0)
    );
  }

  const total = cart.reduce((sum, l) => sum + l.item.price * l.qty, 0);

  async function sendOrder() {
    if (cart.length === 0) return;
    setSending(true);

    // 1. Insert the order (parent row)
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({ table_number: tableNo, total })
      .select()
      .single();

    if (orderErr) {
      alert('Order failed: ' + orderErr.message);
      setSending(false);
      return;
    }

    // 2. Insert all the line items
    const lines = cart.map((l) => ({
      order_id: order.id,
      menu_item_id: l.item.id,
      name_snapshot: l.item.name_en,
      price_at_time: l.item.price,
      qty: l.qty,
    }));

    const { error: linesErr } = await supabase.from('order_items').insert(lines);

    if (linesErr) {
      alert('Order items failed: ' + linesErr.message);
      setSending(false);
      return;
    }

    // 3. Success — clear cart, show confirmation
    setLastOrder(order.id);
    setCart([]);
    setSending(false);
  }

  return (
    <main className="min-h-screen bg-amber-50 p-4 md:p-6">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold text-red-800">🥟 Dim Sum POS</h1>
        <label className="flex items-center gap-2 text-stone-700">
          Table
          <input
            type="number" min={1}
            value={tableNo}
            onChange={(e) => setTableNo(Number(e.target.value))}
            className="w-16 px-2 py-1 border border-stone-300 rounded font-mono"
          />
        </label>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* MENU GRID */}
        <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => addToCart(item)}
              className="bg-white rounded-lg p-4 shadow-sm border border-amber-100 text-left hover:border-red-400 active:scale-95 transition"
            >
              <h3 className="font-bold text-stone-800">{item.name_en}</h3>
              <p className="text-sm text-stone-500">{item.name_zh}</p>
              <p className="mt-2 text-red-700 font-mono">RM {item.price}</p>
            </button>
          ))}
        </section>

        {/* CART PANEL */}
        <aside className="bg-white rounded-lg shadow-sm border border-amber-100 p-4 flex flex-col h-fit lg:sticky lg:top-4">
          <h2 className="font-bold text-stone-800 mb-3">Table {tableNo}</h2>

          {cart.length === 0 && (
            <p className="text-stone-400 text-sm">
              Tap items to add them.
            </p>
          )}

          <ul className="space-y-2 mb-4">
            {cart.map((l) => (
              <li key={l.item.id} className="flex justify-between items-center text-sm">
                <span>{l.item.name_en}</span>
                <span className="flex items-center gap-2">
                  <button
                    onClick={() => removeOne(l.item.id)}
                    className="w-6 h-6 rounded bg-stone-100 text-stone-600 hover:bg-stone-200"
                  >−</button>
                  <span className="font-mono w-6 text-center">{l.qty}</span>
                  <button
                    onClick={() => addToCart(l.item)}
                    className="w-6 h-6 rounded bg-stone-100 text-stone-600 hover:bg-stone-200"
                  >+</button>
                  <span className="font-mono w-16 text-right text-stone-700">
                    RM {(l.item.price * l.qty).toFixed(2)}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {cart.length > 0 && (
            <>
              <div className="flex justify-between font-bold text-lg text-stone-800 border-t border-amber-100 pt-3">
                <span>Total</span>
                <span className="font-mono text-red-700">RM {total.toFixed(2)}</span>
              </div>
              <button
                onClick={sendOrder}
                disabled={sending}
                className="mt-4 w-full bg-red-700 hover:bg-red-800 disabled:bg-stone-300 text-white font-bold py-3 rounded-lg transition"
              >
                {sending ? 'Sending…' : 'Send to Kitchen'}
              </button>
            </>
          )}

          {lastOrder && cart.length === 0 && (
            <p className="mt-4 text-sm text-green-700 text-center">
              ✓ Order #{lastOrder} sent to kitchen
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}