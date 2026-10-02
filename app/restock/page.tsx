'use client';

// Dedicated restock page — front-counter view.
//
// Restock is ONLY for front-counter food (dim sum, buns, rice, roasted, etc.).
// Noodles & Fried are made to order, and Drinks are stocked by the bar — neither
// goes through this flow — so this page only lists Counter Food items.  Tapping
// one requests a fresh batch; the slip always prints at the kitchen.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  requestRestock,
  listPendingRestock,
  cancelRestock,
} from '@/lib/restock';
import { stationForCategory, type MenuItem, type RestockRequest } from '@/lib/types';

export default function RestockPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [pending, setPending] = useState<RestockRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [restockFor, setRestockFor] = useState<MenuItem | null>(null);
  const [nowTick, setNowTick] = useState<number>(0);

  // "Time ago" ticker.
  useEffect(() => {
    setNowTick(Date.now());
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function loadItems() {
    const { data } = await supabase
      .from('menu_items')
      .select('*')
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restock_requests' }, () => loadPending())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => loadItems())
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

  // Counter food only — everything except Noodles & Fried (kitchen) and Drinks (bar).
  const counterItems = useMemo(
    () =>
      items.filter(
        (i) => i.is_available !== false && stationForCategory(i.category) === 'cashier'
      ),
    [items]
  );

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

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1600px] mx-auto px-4 md:px-6 py-5 md:py-6">
      <header className="mb-5 md:mb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-500)]">
          Front counter · 前檯
        </p>
        <div className="flex flex-wrap items-end justify-between gap-2 mt-1">
          <h1 className="text-2xl md:text-4xl font-bold text-[var(--ink-900)]">
            Restock <span className="text-[var(--ink-500)] font-normal text-lg md:text-2xl">· 補貨</span>
          </h1>
          <span className="text-xs text-[var(--ink-400)]">
            {counterItems.length} counter item{counterItems.length === 1 ? '' : 's'}
          </span>
        </div>
        <p className="text-sm text-[var(--ink-500)] mt-1">
          Ran out of a dim sum / bun / rice dish? Tap it — a slip prints at the kitchen.
        </p>
      </header>

      {/* Pending requests */}
      {pending.length > 0 && (
        <section className="mb-6 md:mb-8">
          <div
            className="rounded-2xl md:rounded-3xl overflow-hidden border-2"
            style={{ borderColor: 'var(--warn-500)', boxShadow: '0 12px 28px -8px rgb(234 88 12 / 0.25)' }}
          >
            <div
              className="flex items-center justify-between px-4 md:px-5 py-3 text-white"
              style={{ background: 'linear-gradient(90deg, var(--warn-500), var(--brand-700))' }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-70 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
                </span>
                <h2 className="text-xs md:text-sm font-bold uppercase tracking-widest truncate">
                  Pending — waiting on kitchen
                </h2>
              </div>
              <span className="text-sm font-bold font-mono shrink-0">{pending.length}</span>
            </div>
            <ul className="p-3 md:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-white">
              {pending.map((r) => (
                <li
                  key={r.id}
                  className="rounded-2xl p-3 md:p-4 flex items-start gap-3 bg-[var(--cream-100)] border border-[var(--cream-300)]"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[var(--ink-900)] leading-tight truncate">
                      {r.item_name_snapshot}
                    </p>
                    {r.item_name_zh_snapshot && (
                      <p className="text-sm text-[var(--ink-600)] truncate">{r.item_name_zh_snapshot}</p>
                    )}
                    <p className="text-xs text-[var(--warn-500)] font-semibold mt-1">
                      {r.qty_wanted ? `${r.qty_wanted} baskets · ` : ''}
                      {ageOf(r.requested_at)}
                    </p>
                    {r.note && (
                      <p className="text-xs mt-1.5 px-2 py-1 rounded bg-white text-[var(--ink-700)] break-words">
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

      {loading && <p className="text-[var(--ink-500)]">Loading menu…</p>}

      {!loading && counterItems.length === 0 && (
        <div className="text-center py-16 md:py-20">
          <div className="text-5xl md:text-6xl mb-3 opacity-40">🥟</div>
          <p className="text-lg text-[var(--ink-700)] font-semibold">No counter food yet</p>
          <p className="text-sm text-[var(--ink-500)] mt-1">
            Add items in the <b>Counter Food</b> category under Admin → Menu.
          </p>
        </div>
      )}

      {/* Items — responsive grid of big tap targets */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2.5 md:gap-3">
        {counterItems.map((item) => (
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

  return (
    <button
      onClick={onRequest}
      className={`card-hover text-left rounded-2xl border transition overflow-hidden flex flex-col ${
        isPending ? 'border-transparent' : 'bg-white border-[var(--ink-200)]'
      }`}
      style={
        isPending
          ? {
              background: 'linear-gradient(135deg, var(--warn-500), var(--brand-700))',
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
      <div className="p-3 md:p-4 flex-1 flex flex-col">
        <p className={`font-bold leading-tight text-sm md:text-base line-clamp-2 ${isPending ? 'text-white' : 'text-[var(--ink-900)]'}`}>
          {item.name_en}
        </p>
        {item.name_zh && (
          <p className={`text-xs md:text-sm line-clamp-1 ${isPending ? 'text-white/80' : 'text-[var(--ink-500)]'}`}>
            {item.name_zh}
          </p>
        )}
        <div className="mt-2.5 md:mt-3">
          {isPending ? (
            <div className="flex items-center gap-1.5 text-xs font-bold text-white">
              <span>🔥 Restocking</span>
              {ageLabel && <span className="text-white/70 font-normal hidden sm:inline">· {ageLabel}</span>}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-[11px] md:text-xs text-[var(--ink-400)]">Tap to request</span>
              <span
                className="text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--warn-500), var(--brand-600))' }}
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
      setErr(e instanceof Error ? e.message : 'Failed to request');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-[var(--ink-900)]/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-3xl max-w-sm w-full p-5 md:p-6 max-h-[95vh] overflow-y-auto animate-rise"
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
          <p className="text-sm text-[var(--ink-500)] mt-1">Prints at 👨‍🍳 Kitchen · 廚房</p>
        </div>

        <div className="bg-[var(--cream-100)] rounded-2xl p-4 mb-4 text-center">
          <p className="text-lg font-bold text-[var(--ink-900)]">{item.name_en}</p>
          {item.name_zh && <p className="text-sm text-[var(--ink-500)]">{item.name_zh}</p>}
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
