'use client';

// Waiter POS terminal — redesigned "Modern Dim Sum House" look.
// Sticky category pills, elegant menu cards, big warm cart with a
// full running-total breakdown and a hero send button.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { computeBreakdown, sumLines } from '@/lib/pricing';
import { useSettings } from '@/lib/use-settings';
import type { MenuItem, ShopSettings } from '@/lib/types';

type CartLine = { item: MenuItem; qty: number };
type ExistingLine = {
  id: number;
  name_en: string;
  name_zh: string | null;
  qty: number;
  price: number;
  kitchen_status: string;
};
type ExistingOrder = { id: number; lines: ExistingLine[] };

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

  // Live menu
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

  // Load existing open order for this table
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
      if (!order) return setExisting(null);

      const { data: rows } = await supabase
        .from('order_items')
        .select('id, name_snapshot, name_zh_snapshot, qty, price_at_time, kitchen_status, voided_at')
        .eq('order_id', order.id)
        .is('voided_at', null)
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

    const channel = supabase
      .channel(`pos-table-${tableNo}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => loadExisting())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadExisting())
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [tableNo]);

  // Categories with counts
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((i) => {
      if (i.is_available === false) return;
      map.set(i.category || 'Other', (map.get(i.category || 'Other') ?? 0) + 1);
    });
    const total = [...map.values()].reduce((s, n) => s + n, 0);
    return [
      { key: 'All', count: total },
      ...[...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => ({ key, count })),
    ];
  }, [items]);

  const visibleItems = useMemo(
    () =>
      items
        .filter((i) => i.is_available !== false)
        .filter((i) => category === 'All' || (i.category || 'Other') === category),
    [items, category]
  );

  // Cart mutations
  function addToCart(item: MenuItem) {
    setCart((prev) => {
      const line = prev.find((l) => l.item.id === item.id);
      if (line) return prev.map((l) => (l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { item, qty: 1 }];
    });
  }
  function removeOne(id: number) {
    setCart((prev) =>
      prev.map((l) => (l.item.id === id ? { ...l, qty: l.qty - 1 } : l)).filter((l) => l.qty > 0)
    );
  }

  // Totals
  const existingSub = existing
    ? sumLines(existing.lines.map((l) => ({ qty: l.qty, price: l.price })))
    : 0;
  const newSub = sumLines(cart.map((l) => ({ qty: l.qty, price: l.item.price })));
  const runningSub = existingSub + newSub;
  const breakdown = computeBreakdown(runningSub, settings);
  const newCount = cart.reduce((s, l) => s + l.qty, 0);

  // Send
  async function sendOrder() {
    if (cart.length === 0) return;
    setSending(true);
    try {
      let orderId: number;
      if (existing) {
        orderId = existing.id;
      } else {
        const init = computeBreakdown(newSub, settings);
        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .insert({
            table_number: tableNo,
            subtotal: init.subtotal,
            service_charge: init.service_charge,
            tax: init.tax,
            rounding: init.rounding,
            total: init.total,
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

      const lines = cart.map((l) => ({
        order_id: orderId,
        menu_item_id: l.item.id,
        name_snapshot: l.item.name_en,
        name_zh_snapshot: l.item.name_zh,
        price_at_time: l.item.price,
        cost_at_time: l.item.cost_price ?? 0,
        qty: l.qty,
      }));

      const { data: inserted, error: linesErr } = await supabase
        .from('order_items')
        .insert(lines)
        .select('id, menu_item_id');
      if (linesErr) {
        alert('Could not add items: ' + linesErr.message);
        setSending(false);
        return;
      }

      // Route each new line to its station's printer.
      // Group inserted item IDs by the menu item's station.
      const byStation = new Map<string, number[]>();
      const menuById = new Map(items.map((i) => [i.id, i]));
      for (const row of inserted ?? []) {
        const menu = menuById.get(row.menu_item_id as number);
        const station = menu?.station ?? 'kitchen';
        if (!byStation.has(station)) byStation.set(station, []);
        byStation.get(station)!.push(row.id as number);
      }
      const jobs = [...byStation.entries()].map(([station, item_ids]) => ({
        order_id: orderId,
        station,
        kind: 'kitchen',
        payload: { item_ids },
      }));
      if (jobs.length > 0) {
        await supabase.from('print_jobs').insert(jobs);
      }

      if (existing) {
        const b = computeBreakdown(runningSub, settings);
        await supabase
          .from('orders')
          .update({
            subtotal: b.subtotal,
            service_charge: b.service_charge,
            tax: b.tax,
            rounding: b.rounding,
            total: b.total,
            status: 'open',
          })
          .eq('id', orderId);
      }

      setCart([]);
      setFlash(existing ? `✓ Added to Table ${tableNo}` : `✓ Order #${orderId} sent to kitchen`);
      setTimeout(() => setFlash(null), 2600);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1600px] mx-auto px-4 md:px-6 py-6">
      <PageHeader tableNo={tableNo} onTable={(n) => { setTableNo(n); setCart([]); setFlash(null); }} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6 mt-6">
        <section>
          {/* Category rail */}
          <div className="sticky top-14 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-[var(--cream-50)]/85 backdrop-blur border-b border-[var(--ink-200)] mb-4">
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
              {categories.map((c) => {
                const active = category === c.key;
                return (
                  <button
                    key={c.key}
                    onClick={() => setCategory(c.key)}
                    className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition ${
                      active
                        ? 'bg-[var(--brand-600)] text-white shadow-md'
                        : 'bg-white text-[var(--ink-700)] border border-[var(--ink-200)] hover:border-[var(--brand-400)]'
                    }`}
                    style={active ? { boxShadow: 'var(--shadow-brand)' } : undefined}
                  >
                    {c.key}
                    <span className={`ml-2 text-xs ${active ? 'text-white/80' : 'text-[var(--ink-400)]'}`}>
                      {c.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Menu grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {visibleItems.map((item) => (
              <MenuButton
                key={item.id}
                item={item}
                onAdd={() => addToCart(item)}
              />
            ))}
            {visibleItems.length === 0 && (
              <div className="col-span-full py-16 text-center">
                <p className="text-[var(--ink-500)]">No items in {category}.</p>
                <p className="text-xs text-[var(--ink-400)] mt-1">Add items in Admin → Menu.</p>
              </div>
            )}
          </div>
        </section>

        {/* Cart */}
        <aside className="lg:sticky lg:top-[76px] h-fit">
          <CartPanel
            tableNo={tableNo}
            existing={existing}
            cart={cart}
            breakdown={breakdown}
            settings={settings}
            newCount={newCount}
            onRemoveOne={removeOne}
            onAddOne={(id) => {
              const it = items.find((i) => i.id === id);
              if (it) addToCart(it);
            }}
            sending={sending}
            onSend={sendOrder}
            flash={flash}
          />
        </aside>
      </div>
    </main>
  );
}

// ─── page header ──────────────────────────────────────────────────────────

function PageHeader({
  tableNo,
  onTable,
}: {
  tableNo: number;
  onTable: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-500)]">
          Waiter · 服務員
        </p>
        <h1 className="text-3xl md:text-4xl font-bold text-[var(--ink-900)] mt-1">
          Take Order
        </h1>
      </div>
      <div className="flex items-center gap-2 bg-white rounded-2xl p-2 pl-4 border border-[var(--ink-200)]"
           style={{ boxShadow: 'var(--shadow-sm)' }}>
        <span className="text-xs uppercase tracking-wider text-[var(--ink-500)]">Table</span>
        <button
          onClick={() => onTable(Math.max(1, tableNo - 1))}
          className="w-9 h-9 rounded-lg bg-[var(--ink-100)] hover:bg-[var(--ink-200)] text-[var(--ink-700)] text-lg font-bold"
        >
          −
        </button>
        <input
          type="number"
          min={1}
          value={tableNo}
          onChange={(e) => onTable(Math.max(1, Number(e.target.value) || 1))}
          className="w-14 text-center font-mono text-2xl font-bold text-[var(--brand-700)] bg-transparent focus:outline-none"
        />
        <button
          onClick={() => onTable(tableNo + 1)}
          className="w-9 h-9 rounded-lg bg-[var(--ink-100)] hover:bg-[var(--ink-200)] text-[var(--ink-700)] text-lg font-bold"
        >
          +
        </button>
      </div>
    </div>
  );
}

// ─── menu button ──────────────────────────────────────────────────────────

function MenuButton({ item, onAdd }: { item: MenuItem; onAdd: () => void }) {
  return (
    <button
      onClick={onAdd}
      className="card-hover text-left bg-white rounded-2xl p-4 border border-[var(--ink-200)] active:scale-[0.98]"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="min-h-[52px]">
        <h3 className="font-bold text-[var(--ink-900)] leading-snug text-[15px]">
          {item.name_en}
        </h3>
        {item.name_zh && (
          <p className="text-sm text-[var(--ink-500)] mt-0.5">{item.name_zh}</p>
        )}
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-[var(--brand-700)] font-mono font-bold">
          RM {Number(item.price).toFixed(2)}
        </span>
        <span
          className="text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center text-white transition"
          style={{
            background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))',
          }}
        >
          +
        </span>
      </div>
    </button>
  );
}

// ─── cart panel ───────────────────────────────────────────────────────────

function CartPanel({
  tableNo,
  existing,
  cart,
  breakdown,
  settings,
  newCount,
  onRemoveOne,
  onAddOne,
  sending,
  onSend,
  flash,
}: {
  tableNo: number;
  existing: ExistingOrder | null;
  cart: CartLine[];
  breakdown: ReturnType<typeof computeBreakdown>;
  settings: ShopSettings;
  newCount: number;
  onRemoveOne: (id: number) => void;
  onAddOne: (id: number) => void;
  sending: boolean;
  onSend: () => void;
  flash: string | null;
}) {
  return (
    <div
      className="bg-white rounded-3xl border border-[var(--ink-200)] overflow-hidden"
      style={{ boxShadow: 'var(--shadow-md)' }}
    >
      {/* Header */}
      <div
        className="px-5 py-4 text-white"
        style={{
          background:
            'linear-gradient(135deg, var(--brand-700), var(--brand-900))',
        }}
      >
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-white/70">
              Table
            </p>
            <p className="text-2xl font-bold">
              {tableNo}
              {existing && (
                <span className="ml-2 text-xs font-normal text-white/70 font-mono">
                  #{existing.id}
                </span>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.25em] text-white/70">Total</p>
            <p className="text-3xl font-bold font-mono">
              RM {breakdown.total.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      <div className="p-5">
        {/* Existing items */}
        {existing && existing.lines.length > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-widest text-[var(--ink-400)] font-semibold mb-2">
              On this table
            </p>
            <ul className="space-y-1.5 mb-4">
              {existing.lines.map((l) => (
                <li key={l.id} className="flex justify-between items-baseline text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-[var(--ink-400)]">{l.qty}×</span>{' '}
                    <span className="text-[var(--ink-700)]">{l.name_en}</span>
                    {l.name_zh && (
                      <span className="text-[var(--ink-400)] ml-1">· {l.name_zh}</span>
                    )}
                    <StatusBadge status={l.kitchen_status} />
                  </span>
                  <span className="font-mono text-[var(--ink-500)] ml-2">
                    RM {(l.price * l.qty).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="h-px bg-[var(--ink-200)] mb-4" />
          </>
        )}

        {/* New cart */}
        <p className="text-[10px] uppercase tracking-widest text-[var(--ink-400)] font-semibold mb-2">
          New order
        </p>
        {cart.length === 0 ? (
          <div className="text-center py-6 bg-[var(--cream-100)] rounded-xl mb-4">
            <div className="text-3xl mb-1">🥢</div>
            <p className="text-sm text-[var(--ink-500)]">
              Tap items to add them.
            </p>
          </div>
        ) : (
          <ul className="space-y-2 mb-4">
            {cart.map((l) => (
              <li
                key={l.item.id}
                className="flex items-center justify-between gap-2 bg-[var(--cream-100)] rounded-xl px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--ink-900)] truncate">
                    {l.item.name_en}
                  </p>
                  {l.item.name_zh && (
                    <p className="text-xs text-[var(--ink-500)] truncate">
                      {l.item.name_zh}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onRemoveOne(l.item.id)}
                    className="w-8 h-8 rounded-lg bg-white border border-[var(--ink-200)] text-[var(--ink-700)] font-bold text-lg hover:border-[var(--brand-400)]"
                    aria-label="Remove one"
                  >
                    −
                  </button>
                  <span className="font-mono w-6 text-center font-bold">{l.qty}</span>
                  <button
                    onClick={() => onAddOne(l.item.id)}
                    className="w-8 h-8 rounded-lg bg-white border border-[var(--ink-200)] text-[var(--ink-700)] font-bold text-lg hover:border-[var(--brand-400)]"
                    aria-label="Add one"
                  >
                    +
                  </button>
                </div>
                <span className="font-mono w-16 text-right text-sm text-[var(--brand-700)] font-bold">
                  RM {(l.item.price * l.qty).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Breakdown */}
        {(existing || cart.length > 0) && (
          <div className="text-sm space-y-1 border-t border-[var(--ink-100)] pt-4">
            <Row label="Subtotal" value={breakdown.subtotal} />
            {breakdown.service_charge > 0 && (
              <Row label={`Service ${Number(settings.service_charge_pct)}%`} value={breakdown.service_charge} />
            )}
            {breakdown.tax > 0 && (
              <Row label={`SST ${Number(settings.sst_pct)}%`} value={breakdown.tax} />
            )}
            {breakdown.rounding !== 0 && <Row label="Rounding" value={breakdown.rounding} />}
          </div>
        )}

        {/* Send */}
        {cart.length > 0 && (
          <button
            onClick={onSend}
            disabled={sending}
            className="mt-5 w-full text-white font-bold py-4 rounded-2xl text-base transition disabled:opacity-60"
            style={{
              background:
                'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
              boxShadow: 'var(--shadow-brand)',
            }}
          >
            {sending
              ? 'Sending…'
              : existing
              ? `Add ${newCount} to Kitchen  ·  RM ${breakdown.total.toFixed(2)}`
              : `Send ${newCount} to Kitchen  ·  RM ${breakdown.total.toFixed(2)}`}
          </button>
        )}

        {flash && (
          <div className="mt-4 text-center py-2 px-3 rounded-xl bg-[var(--jade-100)] text-[var(--jade-600)] text-sm font-semibold">
            {flash}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-[var(--ink-500)]">
      <span>{label}</span>
      <span className="font-mono">RM {value.toFixed(2)}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'served') return null;
  const map: Record<string, string> = {
    cooking: 'bg-[var(--gold-400)]/20 text-[var(--gold-600)]',
    pending: 'bg-[var(--ink-100)] text-[var(--ink-500)]',
  };
  const cls = map[status] ?? map.pending;
  return (
    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full uppercase font-bold ${cls}`}>
      {status}
    </span>
  );
}
