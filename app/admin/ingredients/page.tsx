'use client';

// Ingredients CRUD — tracks the "modal" price of each raw material.
// Used later by recipes to auto-compute menu item cost.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { INGREDIENT_UNITS, type Ingredient } from '@/lib/types';

type Draft = {
  id?: number;
  name: string;
  name_zh: string;
  supplier: string;
  cost_price: string;
  unit: string;
  stock_qty: string;
  low_stock_at: string;
  note: string;
  active: boolean;
};

const EMPTY: Draft = {
  name: '',
  name_zh: '',
  supplier: '',
  cost_price: '',
  unit: 'kg',
  stock_qty: '',
  low_stock_at: '',
  note: '',
  active: true,
};

export default function IngredientsPage() {
  const [items, setItems] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function load() {
    const { data } = await supabase
      .from('ingredients')
      .select('*')
      .order('active', { ascending: false })
      .order('name');
    setItems((data ?? []) as Ingredient[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel('ingredients')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredients' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.name_zh ?? '').toLowerCase().includes(q) ||
        (i.supplier ?? '').toLowerCase().includes(q)
    );
  }, [items, search]);

  const totalStockValue = useMemo(() => {
    return items
      .filter((i) => i.active && i.stock_qty != null)
      .reduce((s, i) => s + Number(i.cost_price) * Number(i.stock_qty ?? 0), 0);
  }, [items]);

  function startAdd() {
    setDraft({ ...EMPTY });
    setErr(null);
  }
  function startEdit(i: Ingredient) {
    setDraft({
      id: i.id,
      name: i.name,
      name_zh: i.name_zh ?? '',
      supplier: i.supplier ?? '',
      cost_price: String(i.cost_price),
      unit: i.unit,
      stock_qty: i.stock_qty != null ? String(i.stock_qty) : '',
      low_stock_at: i.low_stock_at != null ? String(i.low_stock_at) : '',
      note: i.note ?? '',
      active: i.active,
    });
    setErr(null);
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) return setErr('Name is required');
    const cost = Number(draft.cost_price);
    if (!Number.isFinite(cost) || cost < 0) return setErr('Cost price must be non-negative');

    setSaving(true);
    setErr(null);
    const payload = {
      name: draft.name.trim(),
      name_zh: draft.name_zh.trim() || null,
      supplier: draft.supplier.trim() || null,
      cost_price: cost,
      unit: draft.unit || 'kg',
      stock_qty: draft.stock_qty === '' ? null : Number(draft.stock_qty),
      low_stock_at: draft.low_stock_at === '' ? null : Number(draft.low_stock_at),
      note: draft.note.trim() || null,
      active: draft.active,
      updated_at: new Date().toISOString(),
    };
    const { error } = draft.id
      ? await supabase.from('ingredients').update(payload).eq('id', draft.id)
      : await supabase.from('ingredients').insert(payload);
    setSaving(false);
    if (error) return setErr(error.message);
    setDraft(null);
    load();
  }

  async function toggle(i: Ingredient) {
    await supabase.from('ingredients').update({ active: !i.active }).eq('id', i.id);
  }
  async function del(i: Ingredient) {
    if (!confirm(`Delete ${i.name}?`)) return;
    await supabase.from('ingredients').delete().eq('id', i.id);
  }

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1200px] mx-auto px-4 md:px-6 py-6">
      <header className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <a href="/admin" className="text-xs uppercase tracking-widest text-[var(--ink-500)] hover:text-[var(--brand-600)]">
            ← Dashboard
          </a>
          <h1 className="text-3xl md:text-4xl font-bold text-[var(--ink-900)] mt-2">
            Ingredients · 材料
          </h1>
          <p className="text-sm text-[var(--ink-500)] mt-1">
            Track the modal (本錢) — the price you pay for each raw material.
          </p>
        </div>
        <button
          onClick={startAdd}
          className="text-white font-bold px-5 py-3 rounded-2xl"
          style={{
            background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
            boxShadow: 'var(--shadow-brand)',
          }}
        >
          + Add ingredient
        </button>
      </header>

      {/* Summary bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Active ingredients" value={String(items.filter((i) => i.active).length)} />
        <StatCard
          label="Low-stock alerts"
          value={String(
            items.filter(
              (i) =>
                i.active &&
                i.low_stock_at != null &&
                i.stock_qty != null &&
                Number(i.stock_qty) <= Number(i.low_stock_at)
            ).length
          )}
          warn
        />
        <StatCard label="Est. stock value" value={`RM ${totalStockValue.toFixed(2)}`} accent />
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, Chinese name, or supplier…"
          className="w-full max-w-md px-4 py-3 border border-[var(--ink-200)] rounded-xl bg-white focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
        />
      </div>

      {loading ? (
        <p className="text-[var(--ink-500)]">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-3 opacity-40">🥬</div>
          <p className="text-lg text-[var(--ink-700)] font-semibold">
            {items.length === 0 ? 'No ingredients yet' : 'No match'}
          </p>
          <p className="text-sm text-[var(--ink-500)] mt-1">
            {items.length === 0
              ? 'Add your first raw material — prawns, flour, tea leaves, etc.'
              : 'Try a different search term.'}
          </p>
        </div>
      ) : (
        <section
          className="bg-white rounded-3xl border border-[var(--ink-200)] overflow-hidden"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <ul className="divide-y divide-[var(--ink-100)]">
            {filtered.map((i) => {
              const lowStock =
                i.low_stock_at != null &&
                i.stock_qty != null &&
                Number(i.stock_qty) <= Number(i.low_stock_at);
              return (
                <li
                  key={i.id}
                  className={`flex flex-wrap items-center gap-3 px-5 py-4 ${
                    !i.active ? 'opacity-60 bg-[var(--ink-100)]/50' : ''
                  }`}
                >
                  <div className="flex-1 min-w-[220px]">
                    <div className="font-bold text-[var(--ink-900)] flex items-center gap-2">
                      {i.name}
                      {lowStock && (
                        <span className="text-[10px] px-2 py-0.5 rounded-lg bg-[var(--warn-500)]/20 text-[var(--warn-500)] uppercase font-bold tracking-widest">
                          Low
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-[var(--ink-500)] flex items-center gap-2">
                      {i.name_zh && <span>{i.name_zh}</span>}
                      {i.supplier && (
                        <span className="text-xs text-[var(--ink-400)]">· {i.supplier}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right w-28">
                    <div className="font-mono font-bold text-[var(--brand-700)]">
                      RM {Number(i.cost_price).toFixed(2)}
                    </div>
                    <div className="text-[10px] text-[var(--ink-400)]">per {i.unit}</div>
                  </div>
                  <div className="text-right w-24">
                    {i.stock_qty != null ? (
                      <div className="text-sm font-mono text-[var(--ink-700)]">
                        {Number(i.stock_qty)} {i.unit}
                      </div>
                    ) : (
                      <div className="text-[10px] text-[var(--ink-400)]">no stock</div>
                    )}
                  </div>
                  <button
                    onClick={() => toggle(i)}
                    className={`text-[10px] px-3 py-1.5 rounded-lg font-bold uppercase tracking-widest ${
                      i.active
                        ? 'bg-[var(--jade-100)] text-[var(--jade-600)]'
                        : 'bg-[var(--ink-200)] text-[var(--ink-500)]'
                    }`}
                  >
                    {i.active ? 'Active' : 'Off'}
                  </button>
                  <button
                    onClick={() => startEdit(i)}
                    className="text-xs px-3 py-2 rounded-lg bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-[var(--ink-800)] font-bold"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => del(i)}
                    className="text-xs px-3 py-2 rounded-lg bg-[var(--brand-50)] hover:bg-[var(--brand-100)] text-[var(--brand-700)] font-bold"
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {draft && (
        <IngredientModal
          draft={draft}
          setDraft={setDraft}
          err={err}
          saving={saving}
          onCancel={() => setDraft(null)}
          onSave={save}
        />
      )}
    </main>
  );
}

// ─── ingredient modal ─────────────────────────────────────────────────────

function IngredientModal({
  draft,
  setDraft,
  err,
  saving,
  onCancel,
  onSave,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  err: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-[var(--ink-900)]/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={() => !saving && onCancel()}
    >
      <div
        className="bg-white rounded-3xl max-w-md w-full p-6 animate-rise max-h-[95vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <h2 className="text-xl font-bold text-[var(--ink-900)] mb-5">
          {draft.id ? 'Edit ingredient' : 'Add ingredient'}
        </h2>

        <F label="Name">
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
          />
        </F>

        <F label="Chinese name (中文)">
          <input
            value={draft.name_zh}
            onChange={(e) => setDraft({ ...draft, name_zh: e.target.value })}
            className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
          />
        </F>

        <F label="Supplier (optional)">
          <input
            value={draft.supplier}
            onChange={(e) => setDraft({ ...draft, supplier: e.target.value })}
            placeholder="e.g. Pasar Tani, wholesale market"
            className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
          />
        </F>

        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <F label="Cost / Modal 本錢 (RM)">
            <input
              type="number"
              step="0.01"
              value={draft.cost_price}
              onChange={(e) => setDraft({ ...draft, cost_price: e.target.value })}
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl font-mono focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
          </F>
          <F label="Unit">
            <select
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            >
              {INGREDIENT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </F>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <F label="Current stock (optional)">
            <input
              type="number"
              step="0.1"
              value={draft.stock_qty}
              onChange={(e) => setDraft({ ...draft, stock_qty: e.target.value })}
              placeholder="—"
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl font-mono focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
          </F>
          <F label="Alert when below">
            <input
              type="number"
              step="0.1"
              value={draft.low_stock_at}
              onChange={(e) => setDraft({ ...draft, low_stock_at: e.target.value })}
              placeholder="—"
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl font-mono focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
          </F>
        </div>

        <F label="Note (optional)">
          <textarea
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            rows={2}
            placeholder="e.g. best quality prawn from KKV wet market"
            className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
          />
        </F>

        <label className="flex items-center gap-2 mb-5 text-sm text-[var(--ink-800)] cursor-pointer">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            className="w-4 h-4 accent-[var(--brand-600)]"
          />
          Active (available for recipes)
        </label>

        {err && (
          <div className="bg-[var(--brand-50)] border border-[var(--brand-100)] text-[var(--brand-700)] p-2 rounded-xl mb-4 text-sm">
            {err}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-[var(--ink-800)] font-bold py-3 rounded-2xl"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="text-white font-bold py-3 rounded-2xl disabled:opacity-60"
            style={{
              background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
              boxShadow: 'var(--shadow-brand)',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-1.5 font-semibold">
        {label}
      </span>
      {children}
    </label>
  );
}

function StatCard({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  const bg = accent
    ? 'linear-gradient(135deg, var(--brand-600), var(--brand-800))'
    : warn
    ? 'linear-gradient(135deg, var(--warn-500), var(--brand-700))'
    : undefined;
  const white = accent || warn;
  return (
    <div
      className={`rounded-2xl p-4 ${white ? 'text-white' : 'bg-white text-[var(--ink-900)] border border-[var(--ink-200)]'}`}
      style={bg ? { background: bg, boxShadow: 'var(--shadow-brand)' } : { boxShadow: 'var(--shadow-sm)' }}
    >
      <p className={`text-[10px] uppercase tracking-widest ${white ? 'text-white/70' : 'text-[var(--ink-500)]'} font-semibold`}>
        {label}
      </p>
      <p className="text-2xl font-bold font-mono mt-1">{value}</p>
    </div>
  );
}
