'use client';

// Waiter POS terminal — redesigned "Modern Dim Sum House" look.
// Sticky category pills, elegant menu cards, big warm cart with a
// full running-total breakdown and a hero send button.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { computeBreakdown, sumLines } from '@/lib/pricing';
import { useSettings } from '@/lib/use-settings';
import { ModalShell, PrimaryBtn, SecondaryBtn } from '@/components/ui';
import { getCurrentUser } from '@/lib/roles';
import {
  MENU_CATEGORIES,
  stationForCategory,
  type MenuItem,
  type PrintStation,
  type ShopSettings,
} from '@/lib/types';

type CartLine = {
  key: string;         // unique per line (so two lines of same item stay distinct)
  item: MenuItem;
  qty: number;
  options: string[];   // e.g. ['No pork', 'Extra sauce']
  note: string;        // free text
};
type ExistingLine = {
  id: number;
  menu_item_id: number | null;
  name_en: string;
  name_zh: string | null;
  qty: number;
  price: number;
  options: string | null;
  note: string | null;
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
  // Category filter for faster ordering — 'all' shows every category.
  // Any other value must match a MenuItem.category key exactly.
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [optionsFor, setOptionsFor] = useState<MenuItem | null>(null);

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
        .select('id, menu_item_id, name_snapshot, name_zh_snapshot, qty, price_at_time, options, note, kitchen_status, voided_at')
        .eq('order_id', order.id)
        .is('voided_at', null)
        .order('id');
      setExisting({
        id: order.id,
        lines: (rows ?? []).map((r) => ({
          id: r.id,
          menu_item_id: r.menu_item_id,
          name_en: r.name_snapshot,
          name_zh: r.name_zh_snapshot,
          qty: r.qty,
          price: Number(r.price_at_time),
          options: r.options,
          note: r.note,
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

  // Items visible after station + category filters — grouped for display.
  const visibleItems = useMemo(
    () =>
      items
        // Hide items that the owner marked "off menu" (is_available = false)
        // or that the shop toggled "sold out today" (temporarily_disabled = true).
        .filter((i) => i.is_available !== false && i.temporarily_disabled !== true)
        .filter((i) => categoryFilter === 'all' || (i.category || 'Counter') === categoryFilter),
    [items, categoryFilter]
  );

  // Per-category counts — one number under each category chip.
  const categoryCounts = useMemo(() => {
    const available = items.filter(
      (i) => i.is_available !== false && i.temporarily_disabled !== true
    );
    const counts: Record<string, number> = { all: available.length };
    for (const c of MENU_CATEGORIES) counts[c.key] = 0;
    for (const it of available) {
      const k = it.category || 'Counter';
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }, [items]);

  const grouped = useMemo(() => {
    const m = new Map<string, MenuItem[]>();
    for (const i of visibleItems) {
      const c = i.category || 'Counter';
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(i);
    }
    // Sort sections in the category order defined in lib/types
    // (Noodles, Counter, Drinks), then any unrecognised keys.
    const order = MENU_CATEGORIES.map((c) => c.key);
    return [...m.entries()].sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [visibleItems]);

  // Lookup map used by the cart to render thumbnails for existing (sent)
  // items — the order_items row only carries name snapshots, not images.
  const imageByItemId = useMemo(() => {
    const m = new Map<number, string>();
    items.forEach((i) => {
      if (i.image_url) m.set(i.id, i.image_url);
    });
    return m;
  }, [items]);

  // Cart mutations
  // Opening the item opens a modal for qty + optional modifiers + note.
  // If the user just wants a plain qty=1 with no options, they can tap "Add"
  // in the modal without touching anything.
  function openAddModal(item: MenuItem) {
    setOptionsFor(item);
  }

  function addLineToCart(line: CartLine) {
    // If a matching plain line (no options, no note) already exists, just
    // bump its qty. Otherwise add as a new line so notes stay distinct.
    const isPlain = line.options.length === 0 && !line.note.trim();
    setCart((prev) => {
      if (isPlain) {
        const existing = prev.find(
          (l) => l.item.id === line.item.id && l.options.length === 0 && !l.note.trim()
        );
        if (existing) {
          return prev.map((l) =>
            l.key === existing.key ? { ...l, qty: l.qty + line.qty } : l
          );
        }
      }
      return [...prev, line];
    });
  }

  function removeOne(key: string) {
    setCart((prev) =>
      prev.map((l) => (l.key === key ? { ...l, qty: l.qty - 1 } : l)).filter((l) => l.qty > 0)
    );
  }
  function addOne(key: string) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)));
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
        // Record which signed-in user is sending the order so Kitchen,
        // Bar and Cashier screens can display who took it.
        const me = await getCurrentUser();
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
            taken_by_email: me.email,
            taken_by_name: me.name,
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
        options: l.options.length > 0 ? l.options.join(', ') : null,
        note: l.note.trim() || null,
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

      // Route each new line to the right station's printer.
      // Routing is driven by the item's CATEGORY (not its station field):
      //   Noodles → kitchen,  Drinks → bar,  everything else → cashier.
      // See stationForCategory() in lib/types.ts for the single source of
      // truth.  This matches the shop layout: dim sum / buns / rice /
      // roasted / other are plated at the front counter near the cashier,
      // noodles & fried come from the back kitchen, drinks from the bar.
      const byStation = new Map<PrintStation, number[]>();
      const menuById = new Map(items.map((i) => [i.id, i]));
      for (const row of inserted ?? []) {
        const menu = menuById.get(row.menu_item_id as number);
        const station = stationForCategory(menu?.category);
        if (!byStation.has(station)) byStation.set(station, []);
        byStation.get(station)!.push(row.id as number);
      }
      const jobs: Array<{
        order_id: number;
        station: PrintStation;
        kind: 'kitchen' | 'order_summary';
        payload: { item_ids: number[] };
      }> = [];

      // 1) Customer copy FIRST, at the cashier printer, so the customer sees
      //    everything they ordered (kitchen + bar + counter items together)
      //    before the per-station prep tickets roll out.  No prices — it's a
      //    preview; the final bill prints at payment time.
      const allNewIds = [...byStation.values()].flat();
      if (allNewIds.length > 0) {
        jobs.push({
          order_id: orderId,
          station: 'cashier',
          kind: 'order_summary',
          payload: { item_ids: allNewIds },
        });
      }

      // 2) Then one prep ticket per station.  stationForCategory routes:
      //    noodles/fried → kitchen, drinks → bar, everything else → the
      //    cashier/counter (dim sum, buns, rice, roasted, other).  So the
      //    kitchen never sees drinks, the bar never sees food, and the
      //    counter prep ticket excludes noodles/fried and drinks.
      for (const [station, item_ids] of byStation.entries()) {
        jobs.push({ order_id: orderId, station, kind: 'kitchen', payload: { item_ids } });
      }

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

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-6 mt-6">
        <section className="min-w-0">
          {/* Sticky filter bar.  One row of category chips — each category
              maps to exactly one printer (Noodles & Fried → kitchen,
              Counter Food → cashier, Drinks → bar). */}
          <div className="sticky top-14 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-[var(--cream-50)]/90 backdrop-blur border-b border-[var(--ink-200)] mb-6">

            {/* Category filter */}
            <div className="flex items-center gap-3 min-w-0">
              <span className="hidden md:inline text-[10px] uppercase tracking-widest text-[var(--ink-500)] font-bold shrink-0">
                Category · 分類
              </span>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar flex-1 min-w-0">
                <FilterChip
                  active={categoryFilter === 'all'}
                  onClick={() => setCategoryFilter('all')}
                  count={categoryCounts.all ?? 0}
                  variant="primary"
                >
                  <span className="text-base">🍽️</span>
                  <span>All · 全部</span>
                </FilterChip>
                {MENU_CATEGORIES.map((c) => {
                  const n = categoryCounts[c.key] ?? 0;
                  if (n === 0 && categoryFilter !== c.key) return null;
                  return (
                    <FilterChip
                      key={c.key}
                      active={categoryFilter === c.key}
                      onClick={() => setCategoryFilter(c.key)}
                      count={n}
                      variant="primary"
                    >
                      <span className="text-base">{c.emoji}</span>
                      <span>{c.label}</span>
                      <span className="text-[var(--ink-400)] font-normal hidden sm:inline">
                        · {c.label_zh}
                      </span>
                    </FilterChip>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Categories as sections, items in a grid per section.  When
              a single category is filtered we skip the section header
              since the filter chip above already names it. */}
          <div className="space-y-6">
            {grouped.map(([category, list]) => {
              const meta = MENU_CATEGORIES.find((c) => c.key === category);
              return (
              <section key={category}>
                {categoryFilter === 'all' && (
                  <h2 className="text-xs uppercase tracking-widest text-[var(--ink-500)] font-semibold mb-3 flex items-baseline gap-2">
                    {meta && <span className="text-base">{meta.emoji}</span>}
                    <span>{meta ? meta.label : category}</span>
                    {meta && (
                      <span className="text-[var(--ink-400)] font-normal normal-case tracking-normal">
                        · {meta.label_zh}
                      </span>
                    )}
                    <span className="ml-1 text-[var(--ink-400)] font-normal font-mono">
                      {list.length}
                    </span>
                  </h2>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {list.map((item) => (
                    <MenuButton
                      key={item.id}
                      item={item}
                      onAdd={() => openAddModal(item)}
                    />
                  ))}
                </div>
              </section>
              );
            })}

            {grouped.length === 0 && (
              <div className="py-16 text-center">
                <div className="text-6xl mb-3 opacity-40">🥟</div>
                <p className="text-[var(--ink-500)]">No items available.</p>
                <p className="text-xs text-[var(--ink-400)] mt-1">Add items in Admin → Menu.</p>
              </div>
            )}
          </div>
        </section>

        {/* Item options modal */}
        {optionsFor && (
          <ItemOptionsModal
            item={optionsFor}
            onCancel={() => setOptionsFor(null)}
            onAdd={(line) => {
              addLineToCart(line);
              setOptionsFor(null);
            }}
          />
        )}

        {/* Cart — sticky on desktop; on mobile it lives below the menu
             (natural page flow), plus a floating summary chip pinned to
             the bottom of the viewport for one-tap access. */}
        <aside id="cart-panel" className="lg:sticky lg:top-[76px] h-fit scroll-mt-24 pb-24 lg:pb-0">
          <CartPanel
            tableNo={tableNo}
            existing={existing}
            cart={cart}
            breakdown={breakdown}
            settings={settings}
            newCount={newCount}
            imageByItemId={imageByItemId}
            onRemoveOne={removeOne}
            onAddOne={addOne}
            sending={sending}
            onSend={sendOrder}
            flash={flash}
          />
        </aside>
      </div>

      {/* Mobile-only floating cart summary — appears when cart has items */}
      {newCount > 0 && (
        <a
          href="#cart-panel"
          className="lg:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-5 py-3 rounded-full text-white font-bold shadow-lg active:scale-[0.98] transition"
          style={{
            background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
            boxShadow: 'var(--shadow-brand)',
          }}
        >
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/25 text-xs font-mono">
            {newCount}
          </span>
          <span>View cart · 查看</span>
          <span className="font-mono">RM {breakdown.total.toFixed(2)}</span>
        </a>
      )}
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

// Unified filter chip.  `primary` is used for category (bigger, brand
// coloured when active); `secondary` for station (compact, subtler).
function FilterChip({
  active,
  onClick,
  count,
  children,
  variant = 'primary',
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  const isPrimary = variant === 'primary';
  return (
    <button
      onClick={onClick}
      className={[
        'rounded-full whitespace-nowrap transition inline-flex items-center gap-1.5',
        isPrimary
          ? 'px-3.5 md:px-4 py-2 text-sm font-bold'
          : 'px-3 py-1 text-xs font-semibold',
        active
          ? isPrimary
            ? 'bg-[var(--brand-600)] text-white'
            : 'bg-[var(--ink-900)] text-white'
          : 'bg-white text-[var(--ink-700)] border border-[var(--ink-200)] hover:border-[var(--brand-400)]',
      ].join(' ')}
      style={active && isPrimary ? { boxShadow: 'var(--shadow-brand)' } : undefined}
    >
      {children}
      <span className={`ml-1 font-mono ${isPrimary ? 'text-[11px]' : 'text-[10px]'} ${active ? 'text-white/80' : 'text-[var(--ink-400)]'}`}>
        {count}
      </span>
    </button>
  );
}

function MenuButton({ item, onAdd }: { item: MenuItem; onAdd: () => void }) {
  return (
    <button
      onClick={onAdd}
      className="card-hover text-left bg-white rounded-2xl border border-[var(--ink-200)] active:scale-[0.98] overflow-hidden flex flex-col h-full"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      {item.image_url ? (
        <div className="aspect-[4/3] w-full overflow-hidden bg-[var(--cream-100)]">
          <img
            src={item.image_url}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="aspect-[4/3] w-full flex items-center justify-center bg-[var(--cream-100)] text-4xl opacity-40">
          {item.station === 'bar' ? '🫖' : '🥟'}
        </div>
      )}
      <div className="p-3 md:p-4 flex-1 flex flex-col">
        <div className="flex-1 min-h-[42px]">
          <h3 className="font-bold text-[var(--ink-900)] leading-snug text-sm md:text-[15px] line-clamp-2">
            {item.name_en}
          </h3>
          {item.name_zh && (
            <p className="text-xs md:text-sm text-[var(--ink-500)] mt-0.5 line-clamp-1">
              {item.name_zh}
            </p>
          )}
        </div>
        <div className="mt-2.5 md:mt-3 flex items-center justify-between gap-2">
          <span className="text-[var(--brand-700)] font-mono font-bold text-sm md:text-base whitespace-nowrap">
            RM {Number(item.price).toFixed(2)}
          </span>
          <span
            className="text-sm font-bold w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center text-white shrink-0"
            style={{
              background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))',
            }}
          >
            +
          </span>
        </div>
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
  imageByItemId,
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
  imageByItemId: Map<number, string>;
  onRemoveOne: (key: string) => void;
  onAddOne: (key: string) => void;
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
            <ul className="space-y-2 mb-4">
              {existing.lines.map((l) => {
                const img = l.menu_item_id != null ? imageByItemId.get(l.menu_item_id) : undefined;
                return (
                  <li key={l.id} className="flex items-start gap-2 text-sm">
                    <CartThumb src={img} station="kitchen" />
                    <div className="min-w-0 flex-1">
                      <div>
                        <span className="font-mono text-[var(--ink-400)]">{l.qty}×</span>{' '}
                        <span className="text-[var(--ink-700)]">{l.name_en}</span>
                      </div>
                      {l.name_zh && (
                        <div className="text-xs text-[var(--ink-400)]">{l.name_zh}</div>
                      )}
                      {l.options && (
                        <div className="text-[10px] text-[var(--gold-600)] font-semibold mt-0.5">
                          {l.options}
                        </div>
                      )}
                      {l.note && (
                        <div className="text-[10px] text-[var(--ink-500)] italic mt-0.5">
                          "{l.note}"
                        </div>
                      )}
                      <StatusBadge status={l.kitchen_status} />
                    </div>
                    <span className="font-mono text-[var(--ink-500)] ml-2 shrink-0">
                      RM {(l.price * l.qty).toFixed(2)}
                    </span>
                  </li>
                );
              })}
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
                key={l.key}
                className="flex items-start justify-between gap-2 bg-[var(--cream-100)] rounded-xl px-2 py-2"
              >
                <CartThumb src={l.item.image_url ?? undefined} station={l.item.station} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--ink-900)] truncate">
                    {l.item.name_en}
                  </p>
                  {l.item.name_zh && (
                    <p className="text-xs text-[var(--ink-500)] truncate">
                      {l.item.name_zh}
                    </p>
                  )}
                  {l.options.length > 0 && (
                    <p className="text-[10px] text-[var(--gold-600)] font-semibold mt-0.5 truncate">
                      {l.options.join(', ')}
                    </p>
                  )}
                  {l.note && (
                    <p className="text-[10px] text-[var(--ink-500)] italic mt-0.5 truncate">
                      "{l.note}"
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onRemoveOne(l.key)}
                    className="w-8 h-8 rounded-lg bg-white border border-[var(--ink-200)] text-[var(--ink-700)] font-bold text-lg hover:border-[var(--brand-400)]"
                    aria-label="Remove one"
                  >
                    −
                  </button>
                  <span className="font-mono w-6 text-center font-bold">{l.qty}</span>
                  <button
                    onClick={() => onAddOne(l.key)}
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

// ─── item options modal ──────────────────────────────────────────────────

function ItemOptionsModal({
  item,
  onCancel,
  onAdd,
}: {
  item: MenuItem;
  onCancel: () => void;
  onAdd: (line: CartLine) => void;
}) {
  const [qty, setQty] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');

  function toggle(label: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function submit() {
    const line: CartLine = {
      key: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      item,
      qty,
      options: [...selected],
      note: note.trim(),
    };
    onAdd(line);
  }

  return (
    <ModalShell onClose={onCancel} title={item.name_en} sub={item.name_zh ?? undefined}>
      {item.image_url && (
        <div className="w-full aspect-[4/2] rounded-2xl overflow-hidden mb-4 bg-[var(--cream-100)]">
          <img src={item.image_url} alt="" className="w-full h-full object-cover" />
        </div>
      )}

      {item.options_available && item.options_available.length > 0 && (
        <>
          <p className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-2 font-semibold">
            Modifiers
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {item.options_available.map((o, idx) => {
              const label = o.label_zh ? `${o.label} ${o.label_zh}` : o.label;
              const active = selected.has(label);
              return (
                <button
                  key={`${o.label}-${idx}`}
                  onClick={() => toggle(label)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${
                    active
                      ? 'text-white'
                      : 'bg-[var(--cream-100)] text-[var(--ink-700)] border border-[var(--ink-200)] hover:border-[var(--brand-400)]'
                  }`}
                  style={
                    active
                      ? {
                          background: 'linear-gradient(135deg, var(--gold-500), var(--brand-600))',
                        }
                      : undefined
                  }
                >
                  {o.label}
                  {o.label_zh && <span> · {o.label_zh}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}

      <label className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-1.5 font-semibold">
        Note
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. customer is allergic to peanut"
        rows={2}
        className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl mb-4 focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
      />

      <div className="flex items-center gap-3 mb-4 bg-[var(--cream-100)] rounded-xl p-2">
        <span className="text-xs uppercase tracking-widest text-[var(--ink-500)] font-semibold pl-2">
          Quantity
        </span>
        <button
          onClick={() => setQty(Math.max(1, qty - 1))}
          className="w-10 h-10 rounded-lg bg-white border border-[var(--ink-200)] text-lg font-bold"
        >
          −
        </button>
        <span className="flex-1 text-center text-2xl font-bold font-mono">{qty}</span>
        <button
          onClick={() => setQty(qty + 1)}
          className="w-10 h-10 rounded-lg bg-white border border-[var(--ink-200)] text-lg font-bold"
        >
          +
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SecondaryBtn onClick={onCancel}>Cancel</SecondaryBtn>
        <PrimaryBtn onClick={submit}>
          Add {qty > 1 ? `${qty}× ` : ''}· RM {(item.price * qty).toFixed(2)}
        </PrimaryBtn>
      </div>
    </ModalShell>
  );
}

function CartThumb({ src, station }: { src?: string; station: 'kitchen' | 'bar' | 'cashier' }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className="w-10 h-10 rounded-lg object-cover shrink-0 border border-[var(--ink-100)]"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-lg bg-white border border-[var(--ink-100)] flex items-center justify-center text-base shrink-0 opacity-60">
      {station === 'bar' ? '🫖' : '🥟'}
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
