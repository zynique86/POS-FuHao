'use client';

// Dedicated restock page — front-counter view.
//
// Shows every menu item as a big tap target for "request restock".
// Also lists all currently-pending requests with time-since and a
// cancel action, so nothing gets lost.
//
// Separate from the POS so the waiter's ordering flow stays fast and
// uncluttered.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  requestRestock,
  listPendingRestock,
  cancelRestock,
} from '@/lib/restock';
import type { MenuItem, RestockRequest, PrintStation } from '@/lib/types';

type StationFilter = 'all' | 'kitchen' | 'bar';

export default function RestockPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [pending, setPending] = useState<RestockRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StationFilter>('all');
  const [restockFor, setRestockFor] = useState<MenuItem | null>(null);
  const [nowTick, setNowTick] = useState<number>(0);

  // "Time ago" ticker without touching Date.now() in render.
  useEffect(() => {
    setNowTick(Date.now());
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function loadItems() {
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .order('station')
      .order('category')
      .order('sort_order')
      .order('id');
    setItems((data ?? []) as MenuItem[]);
  }
  async function loadPending() {
    setPending(await listPendingRestock());
  }

  useEffect(() => {
    async function boot() {
      await Promise.all([loadItems(), loadPending()]);
      setLoading(false);
    }
    boot();
    const channel = supabase
      .channel('restock-page')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'restock_requests' },
        () => loadPending()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'menu_items' },
        () => loadItems()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const pendingByItemId = useMemo(() => {
    const m = new Map<number, RestockRequest>();
    pending.forEach((r) => m.set(r.menu_item_id, r));
    return m;
  }, [pending]);

  const filteredItems = useMemo(() => {
    return items
      .filter((i) => i.is_available !== false)
      .filter((i) => filter === 'all' || i.station === filter);
  }, [items, filter]);

  const grouped = useMemo(() => {
    const m = new Map<string, MenuItem[]>();
    for (const i of filteredItems) {
      const c = i.category || 'Other';
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(i);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredItems]);

  async function cancel(id: number) {
    if (!confirm('Cancel this restock request?')) return;
    await cancelRestock(id);
  }

  function ageOf(iso: string): string {
    if (!nowTick) return '';
    const mins = Math.floor((nowTick - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 min ago';
    return `${mins} min ago`;
  }

  const counts = {
    all: pending.length,
    kitchen: pending.filter((p) => {
      const it = items.find((i) => i.id === p.menu_item_id);
      return (it?.station ?? 'kitchen') === 'kitchen';
    }).length,
    bar: pending.filter((p) => {
      const it = items.find((i) => i.id === p.menu_item_id);
      return it?.station === 'bar';
    }).length,
  };

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1600px] mx-auto px-4 md:px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-500)]">
            Front counter · 前檯
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-[var(--ink-900)] mt-1">
            Restock
          </h1>
          <p className="text-sm text-[var(--ink-500)] mt-1">
            Ran out of something? Tap it — a slip prints at the right station.
          </p>
        </div>

        {/* Station filter */}
        <div className="flex gap-2 bg-white rounded-2xl p-1.5 border border-[var(--ink-200)]"
             style={{ boxShadow: 'var(--shadow-sm)' }}>
          <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} count={counts.all}>
            All
          </FilterPill>
          <FilterPill active={filter === 'kitchen'} onClick={() => setFilter('kitchen')} count={counts.kitchen}>
            👨‍🍳 Kitchen
          </FilterPill>
          <FilterPill active={filter === 'bar'} onClick={() => setFilter('bar')} count={counts.bar}>
            🫖 Bar
          </FilterPill>
        </div>
      </header>

      {/* Pending requests block */}
      {pending.length > 0 && (
        <section className="mb-8">
          <div
            className="rounded-3xl overflow-hidden border-2"
            style={{
              borderColor: 'var(--warn-500)',
              boxShadow: '0 12px 28px -8px rgb(234 88 12 / 0.25)',
            }}
          >
            <div
              className="flex items-center justify-between px-5 py-3 text-white"
              style={{
                background: 'linear-gradient(90deg, var(--warn-500), var(--brand-700))',
              }}
            >
              <div className="flex items-center gap-3">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-70 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
                </span>
                <h2 className="text-sm font-bold uppercase tracking-widest">
                  Pending — waiting on kitchen
                </h2>
              </div>
              <span className="text-sm font-bold font-mono">{pending.length}</span>
            </div>
            <ul className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-white">
              {pending
                .filter((p) => {
                  if (filter === 'all') return true;
                  const it = items.find((i) => i.id === p.menu_item_id);
                  const st = it?.station ?? 'kitchen';
                  return st === filter;
                })
                .map((r) => (
                  <li
                    key={r.id}
                    className="rounded-2xl p-4 flex items-start gap-3 bg-[var(--cream-100)] border border-[var(--cream-300)]"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-lg font-bold text-[var(--ink-900)] leading-tight">
                        {r.item_name_snapshot}
                      </p>
                      {r.item_name_zh_snapshot && (
                        <p className="text-sm text-[var(--ink-600)]">
                          {r.item_name_zh_snapshot}
                        </p>
                      )}
                      <p className="text-xs text-[var(--warn-500)] font-semibold mt-1">
                        {r.qty_wanted ? `${r.qty_wanted} baskets · ` : ''}
                        {ageOf(r.requested_at)}
                      </p>
                      {r.note && (
                        <p className="text-xs mt-1.5 px-2 py-1 rounded bg-white text-[var(--ink-700)]">
                          {r.note}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => cancel(r.id)}
                      className="shrink-0 text-xs px-3 py-2 rounded-lg bg-white border border-[var(--ink-200)] text-[var(--ink-600)] hover:border-[var(--brand-400)] hover:text-[var(--brand-700)] font-bold"
                    >
                      Cancel
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        </section>
      )}

      {loading && (
        <p className="text-[var(--ink-500)]">Loading menu…</p>
      )}

      {!loading && grouped.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-3 opacity-40">🥟</div>
          <p className="text-lg text-[var(--ink-700)] font-semibold">
            No items in this station
          </p>
          <p className="text-sm text-[var(--ink-500)] mt-1">
            Add items in Admin → Menu.
          </p>
        </div>
      )}

      {/* Menu items grid — big tap targets for restock requests */}
      <div className="space-y-6">
        {grouped.map(([category, list]) => (
          <section key={category}>
            <h2 className="text-xs uppercase tracking-widest text-[var(--ink-500)] font-semibold mb-3">
              {category}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {list.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  pending={pendingByItemId.get(item.id) ?? null}
                  ageLabel={
                    pendingByItemId.get(item.id)
                      ? ageOf(pendingByItemId.get(item.id)!.requested_at)
                      : ''
                  }
                  onRequest={() => setRestockFor(item)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {restockFor && (
        <RestockModal
          item={restockFor}
          onCancel={() => setRestockFor(null)}
          onDone={() => setRestockFor(null)}
        />
      )}
    </main>
  );
}

// ─── item card ────────────────────────────────────────────────────────────

function ItemCard({
  item,
  pending,
  ageLabel,
  onRequest,
}: {
  item: MenuItem;
  pending: RestockRequest | null;
  ageLabel: string;
  onRequest: () => void;
}) {
  const isPending = !!pending;
  const stationLabel = item.station === 'bar' ? '🫖 Bar' : '👨‍🍳 Kitchen';
  const stationColor =
    item.station === 'bar' ? 'var(--jade-600)' : 'var(--brand-700)';

  return (
    <button
      onClick={onRequest}
      className={`card-hover text-left rounded-2xl border transition overflow-hidden ${
        isPending
          ? 'border-transparent'
          : 'bg-white border-[var(--ink-200)]'
      }`}
      style={
        isPending
          ? {
              background:
                'linear-gradient(135deg, var(--warn-500), var(--brand-700))',
              color: 'white',
              boxShadow: '0 12px 24px -8px rgb(234 88 12 / 0.35)',
            }
          : { boxShadow: 'var(--shadow-sm)' }
      }
    >
      {item.image_url && (
        <div className="aspect-[4/3] w-full overflow-hidden bg-[var(--cream-100)]">
          <img
            src={item.image_url}
            alt=""
            loading="lazy"
            className={`w-full h-full object-cover ${isPending ? 'opacity-70' : ''}`}
          />
        </div>
      )}
      <div className="p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span
          className="text-[10px] uppercase tracking-widest font-bold"
          style={{ color: isPending ? 'rgb(255 255 255 / 0.75)' : stationColor }}
        >
          {stationLabel}
        </span>
        {isPending && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-70 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
          </span>
        )}
      </div>
      <p className={`font-bold leading-tight ${isPending ? 'text-white' : 'text-[var(--ink-900)]'}`}>
        {item.name_en}
      </p>
      {item.name_zh && (
        <p className={`text-sm ${isPending ? 'text-white/80' : 'text-[var(--ink-500)]'}`}>
          {item.name_zh}
        </p>
      )}
      <div className="mt-3">
        {isPending ? (
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <span>🔥 Restocking</span>
            {ageLabel && <span className="text-white/70 font-normal">· {ageLabel}</span>}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--ink-400)]">Tap to request</span>
            <span
              className="text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center text-white"
              style={{
                background:
                  'linear-gradient(135deg, var(--warn-500), var(--brand-600))',
              }}
            >
              🔥
            </span>
          </div>
        )}
      </div>
      </div>
    </button>
  );
}

// ─── filter pill ──────────────────────────────────────────────────────────

function FilterPill({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition ${
        active
          ? 'text-white'
          : 'text-[var(--ink-700)] hover:bg-[var(--cream-100)]'
      }`}
      style={
        active
          ? {
              background:
                'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
              boxShadow: 'var(--shadow-brand)',
            }
          : undefined
      }
    >
      {children}
      {count > 0 && (
        <span
          className={`ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded ${
            active ? 'bg-white/20' : 'bg-[var(--warn-500)] text-white'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ─── restock modal ────────────────────────────────────────────────────────

function RestockModal({
  item,
  onCancel,
  onDone,
}: {
  item: MenuItem;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const stationLabel: Record<PrintStation, string> = {
    kitchen: '👨‍🍳 Kitchen · 廚房',
    bar: '🫖 Bar · 水吧',
    cashier: '💰 Cashier · 收銀',
  };

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const by = userRes?.user?.email ?? 'staff';
      const q = qty ? Number(qty) : null;
      await requestRestock(item, q, note, by);
      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to request';
      setErr(msg);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-[var(--ink-900)]/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-3xl max-w-sm w-full p-6 animate-rise"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="text-center mb-4">
          <div
            className="inline-flex w-14 h-14 rounded-2xl items-center justify-center text-2xl mb-2"
            style={{ background: 'linear-gradient(135deg, var(--warn-500), var(--brand-600))' }}
          >
            <span className="text-white">🔥</span>
          </div>
          <h2 className="text-xl font-bold text-[var(--ink-900)]">Restock request</h2>
          <p className="text-sm text-[var(--ink-500)] mt-1">
            Prints at {stationLabel[item.station] ?? 'kitchen'}
          </p>
        </div>

        <div className="bg-[var(--cream-100)] rounded-2xl p-4 mb-4 text-center">
          <p className="text-lg font-bold text-[var(--ink-900)]">{item.name_en}</p>
          {item.name_zh && (
            <p className="text-sm text-[var(--ink-500)]">{item.name_zh}</p>
          )}
        </div>

        <label className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-1.5 font-semibold">
          Quantity wanted (optional)
        </label>
        <input
          type="number"
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="e.g. 5 baskets"
          className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl mb-3 font-mono focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
          autoFocus
        />

        <label className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-1.5 font-semibold">
          Note (optional)
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. urgent, table waiting"
          className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl mb-4 focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
        />

        {err && (
          <div className="bg-[var(--brand-50)] border border-[var(--brand-100)] text-[var(--brand-700)] p-2 rounded-xl mb-3 text-sm">
            {err}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-[var(--ink-800)] font-bold py-3 rounded-2xl"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="text-white font-bold py-3 rounded-2xl disabled:opacity-60"
            style={{
              background: 'linear-gradient(135deg, var(--warn-500), var(--brand-600))',
              boxShadow: '0 10px 24px -8px rgb(234 88 12 / 0.35)',
            }}
          >
            {busy ? 'Sending…' : '🔥 Send to kitchen'}
          </button>
        </div>
      </div>
    </div>
  );
}
