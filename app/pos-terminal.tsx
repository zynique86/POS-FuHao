'use client';

// Waiter POS terminal.
//
// Big-picture changes vs. v1:
//   1. Categories: menu items are grouped by `category`; user taps a tab.
//   2. Bilingual: each button shows EN + 中文; both are snapshotted onto
//      the order_item so receipts stay bilingual forever.
//   3. Open-bill: when a table already has an unpaid order, tapping items
//      APPENDS to that order instead of creating a new one. Waiter sees
//      "already sent" items above a "new" section.
//   4. Live tax preview from shop_settings (SST, service charge, 5-sen
//      rounding) rendered under the cart total.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { computeBreakdown, sumLines } from '@/lib/pricing';
import { useSettings } from '@/lib/use-settings';
import type { MenuItem, ShopSettings } from '@/lib/types';

type CartLine = {
  item: MenuItem;
  qty: number;
};

type ExistingLine = {
  id: number;
  name_en: string;
  name_zh: string | null;
  qty: number;
  price: number;
  kitchen_status: string;
};

type ExistingOrder = {
  id: number;
  lines: ExistingLine[];
};

export default function POSTerminal({
  items: initialItems,
  settings: initialSettings,
}: {
  items: MenuItem[];
  settings: ShopSettings;
}) {
  const [items, setItems] = useState<MenuItem[]>(initialItems);
  const settings = useSettings(initialSettings);

  const [tableNo, setTableNo] = useState<number>(1);
  const [existing, setExisting] = useState<ExistingOrder | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [category, setCategory] = useState<string>('All');
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // ------------------------------------------------------------------
  // Live menu — admin edits price/availability → POS updates instantly.
  // ------------------------------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel('pos-menu')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'menu_items' },
        async () => {
          const { data } = await supabase
            .from('menu_items')
            .select('*')
            .order('category')
            .order('sort_order')
            .order('id');
          if (data) setItems(data as MenuItem[]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // ------------------------------------------------------------------
  // When the table number changes, look for an open (unpaid) order
  // on that table so we can append to it instead of starting a new one.
  // ------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    async function loadExisting() {
      const { data: orders } = await supabase
        .from('orders')
        .select('id')
        .eq('table_number', tableNo)
        .is('paid_at', null)
        .in('status', ['open', 'closed'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (!mounted) return;

      const order = orders?.[0];
      if (!order) {
        setExisting(null);
        return;
      }

      const { data: rows } = await supabase
        .from('order_items')
        .select('id, name_snapshot, name_zh_snapshot, qty, price_at_time, kitchen_status')
        .eq('order_id', order.id)
        .order('id');

      setExisting({
        id: order.id,
        lines: (rows ?? []).map((r) => ({
          id: r.id,
          name_en: r.name_snapshot,
          name_zh: r.name_zh_snapshot,
          qty: r.qty,
          price: Number(r.price_at_time),
          kitchen_status: r.kitchen_status,
        })),
      });
    }

    loadExisting();

    // Subscribe so if kitchen marks items served, the badge updates live.
    const channel = supabase
      .channel(`pos-table-${tableNo}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        () => loadExisting()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => loadExisting()
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [tableNo]);

  // ------------------------------------------------------------------
  // Categories + filtering
  // ------------------------------------------------------------------
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => set.add(i.category || 'Other'));
    return ['All', ...[...set].sort()];
  }, [items]);

  const visibleItems = useMemo(() => {
    return items
      .filter((i) => i.is_available !== false)
      .filter((i) => category === 'All' || (i.category || 'Other') === category);
  }, [items, category]);

  // ------------------------------------------------------------------
  // Cart mutations
  // ------------------------------------------------------------------
  function addToCart(item: MenuItem) {
    setCart((prev) => {
      const existingLine = prev.find((l) => l.item.id === item.id);
      if (existingLine) {
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

  // ------------------------------------------------------------------
  // Totals — combined existing + new for the running bill, and separate
  // "new items" subtotal so waiter knows what they're about to send.
  // ------------------------------------------------------------------
  const existingSubtotal = existing
    ? sumLines(existing.lines.map((l) => ({ qty: l.qty, price: l.price })))
    : 0;
  const newSubtotal = sumLines(cart.map((l) => ({ qty: l.qty, price: l.item.price })));
  const runningSubtotal = existingSubtotal + newSubtotal;

  const runningBreakdown = computeBreakdown(runningSubtotal, settings);

  // ------------------------------------------------------------------
  // Send: append to existing open order, or create a new one.
  // ------------------------------------------------------------------
  async function sendOrder() {
    if (cart.length === 0) return;
    setSending(true);

    try {
      let orderId: number;

      if (existing) {
        orderId = existing.id;
      } else {
        // First send for this table — create the order row.
        const initial = computeBreakdown(newSubtotal, settings);
        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .insert({
            table_number: tableNo,
            subtotal: initial.subtotal,
            service_charge: initial.service_charge,
            tax: initial.tax,
            rounding: initial.rounding,
            total: initial.total,
            status: 'open',
          })
          .select()
          .single();

        if (orderErr || !order) {
          alert('Could not create order: ' + (orderErr?.message ?? 'unknown'));
          setSending(false);
          return;
        }
        orderId = order.id as number;
      }

      // Insert the new line items.
      const lines = cart.map((l) => ({
        order_id: orderId,
        menu_item_id: l.item.id,
        name_snapshot: l.item.name_en,
        name_zh_snapshot: l.item.name_zh,
        price_at_time: l.item.price,
        qty: l.qty,
      }));

      const { data: insertedLines, error: linesErr } = await supabase
        .from('order_items')
        .insert(lines)
        .select('id');
      if (linesErr) {
        alert('Could not add items: ' + linesErr.message);
        setSending(false);
        return;
      }

      // Enqueue a kitchen print job for exactly the items we just added.
      const insertedIds = (insertedLines ?? []).map((r) => r.id);
      if (insertedIds.length > 0) {
        await supabase.from('print_jobs').insert({
          order_id: orderId,
          kind: 'kitchen',
          payload: { item_ids: insertedIds },
        });
      }

      // If appending, recompute totals from ALL items on the order.
      if (existing) {
        const updated = computeBreakdown(runningSubtotal, settings);
        const { error: updErr } = await supabase
          .from('orders')
          .update({
            subtotal: updated.subtotal,
            service_charge: updated.service_charge,
            tax: updated.tax,
            rounding: updated.rounding,
            total: updated.total,
            status: 'open', // reopen if kitchen had marked it closed
          })
          .eq('id', orderId);
        if (updErr) console.warn('Order totals update failed:', updErr.message);
      }

      setCart([]);
      setFlash(existing ? `✓ Added to Table ${tableNo}` : `✓ Order #${orderId} sent`);
      setTimeout(() => setFlash(null), 3000);
    } finally {
      setSending(false);
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <main className="min-h-screen bg-amber-50 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-3xl font-bold text-red-800">🥟 Dim Sum POS</h1>
        <label className="flex items-center gap-2 text-stone-700">
          Table
          <input
            type="number"
            min={1}
            value={tableNo}
            onChange={(e) => {
              // Changing table = fresh cart on the new table. Doing this
              // here (rather than in the tableNo effect) keeps the effect
              // pure and satisfies react-hooks/set-state-in-effect.
              setTableNo(Math.max(1, Number(e.target.value) || 1));
              setCart([]);
              setFlash(null);
            }}
            className="w-20 px-2 py-1 border border-stone-300 rounded font-mono text-lg"
          />
        </label>
      </header>

      {/* CATEGORY TABS */}
      <div className="flex gap-2 overflow-x-auto mb-3 pb-1">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition ${
              category === c
                ? 'bg-red-700 text-white'
                : 'bg-white text-stone-700 border border-stone-200 hover:border-red-400'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* MENU GRID */}
        <section className="grid grid-cols-2 sm:grid-cols-3 gap-3 content-start">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              onClick={() => addToCart(item)}
              className="bg-white rounded-lg p-4 shadow-sm border border-amber-100 text-left hover:border-red-400 active:scale-95 transition"
            >
              <h3 className="font-bold text-stone-800 leading-tight">
                {item.name_en}
              </h3>
              {item.name_zh && (
                <p className="text-base text-stone-700 mt-0.5">{item.name_zh}</p>
              )}
              <p className="mt-2 text-red-700 font-mono">
                RM {Number(item.price).toFixed(2)}
              </p>
            </button>
          ))}
          {visibleItems.length === 0 && (
            <p className="col-span-full text-center text-stone-400 py-10">
              No items in {category}.
            </p>
          )}
        </section>

        {/* CART PANEL */}
        <aside className="bg-white rounded-lg shadow-sm border border-amber-100 p-4 flex flex-col h-fit lg:sticky lg:top-4">
          <div className="flex justify-between items-baseline mb-3">
            <h2 className="font-bold text-stone-800">Table {tableNo}</h2>
            {existing && (
              <span className="text-xs text-stone-400 font-mono">
                Order #{existing.id}
              </span>
            )}
          </div>

          {/* ALREADY-SENT ITEMS */}
          {existing && existing.lines.length > 0 && (
            <>
              <p className="text-xs uppercase tracking-wider text-stone-400 mb-1">
                On this table
              </p>
              <ul className="space-y-1 mb-3 text-sm text-stone-700 border-b border-stone-100 pb-3">
                {existing.lines.map((l) => (
                  <li key={l.id} className="flex justify-between items-baseline">
                    <span>
                      <span className="font-mono text-stone-500">{l.qty}x</span>{' '}
                      {l.name_en}
                      {l.name_zh && (
                        <span className="text-stone-500"> · {l.name_zh}</span>
                      )}
                      <StatusBadge status={l.kitchen_status} />
                    </span>
                    <span className="font-mono text-stone-500">
                      RM {(l.price * l.qty).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* NEW-CART ITEMS */}
          <p className="text-xs uppercase tracking-wider text-stone-400 mb-1">
            New order
          </p>
          {cart.length === 0 && (
            <p className="text-stone-400 text-sm mb-3">
              Tap items to add them.
            </p>
          )}
          <ul className="space-y-2 mb-3">
            {cart.map((l) => (
              <li key={l.item.id} className="flex justify-between items-center text-sm">
                <span className="flex-1 min-w-0 truncate">
                  {l.item.name_en}
                  {l.item.name_zh && (
                    <span className="text-stone-500"> · {l.item.name_zh}</span>
                  )}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => removeOne(l.item.id)}
                    className="w-7 h-7 rounded bg-stone-100 text-stone-600 hover:bg-stone-200"
                    aria-label="Remove one"
                  >
                    −
                  </button>
                  <span className="font-mono w-6 text-center">{l.qty}</span>
                  <button
                    onClick={() => addToCart(l.item)}
                    className="w-7 h-7 rounded bg-stone-100 text-stone-600 hover:bg-stone-200"
                    aria-label="Add one"
                  >
                    +
                  </button>
                  <span className="font-mono w-20 text-right text-stone-700">
                    RM {(l.item.price * l.qty).toFixed(2)}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {/* TAX BREAKDOWN + TOTAL */}
          {(existing || cart.length > 0) && (
            <div className="border-t border-amber-100 pt-3 space-y-1 text-sm">
              <Row label="Subtotal" value={runningBreakdown.subtotal} />
              {runningBreakdown.service_charge > 0 && (
                <Row
                  label={`Service ${Number(settings.service_charge_pct)}%`}
                  value={runningBreakdown.service_charge}
                />
              )}
              {runningBreakdown.tax > 0 && (
                <Row
                  label={`SST ${Number(settings.sst_pct)}%`}
                  value={runningBreakdown.tax}
                />
              )}
              {runningBreakdown.rounding !== 0 && (
                <Row label="Rounding" value={runningBreakdown.rounding} />
              )}
              <div className="flex justify-between font-bold text-lg text-stone-800 pt-1 border-t border-stone-100">
                <span>Total</span>
                <span className="font-mono text-red-700">
                  RM {runningBreakdown.total.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {cart.length > 0 && (
            <button
              onClick={sendOrder}
              disabled={sending}
              className="mt-4 w-full bg-red-700 hover:bg-red-800 disabled:bg-stone-300 text-white font-bold py-3 rounded-lg transition"
            >
              {sending
                ? 'Sending…'
                : existing
                ? `Send +${cart.reduce((s, l) => s + l.qty, 0)} to Kitchen`
                : 'Send to Kitchen'}
            </button>
          )}

          {flash && (
            <p className="mt-3 text-sm text-green-700 text-center">{flash}</p>
          )}
        </aside>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-stone-600">
      <span>{label}</span>
      <span className="font-mono">RM {value.toFixed(2)}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'served') return null;
  const cls =
    status === 'cooking'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-stone-100 text-stone-600';
  return (
    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded uppercase ${cls}`}>
      {status}
    </span>
  );
}
