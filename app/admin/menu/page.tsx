'use client';

// Menu management — redesigned. Category bands, item rows, modal editor.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { MenuItem, PrintStation } from '@/lib/types';

type Draft = {
  id?: number;
  name_en: string;
  name_zh: string;
  price: string;
  cost_price: string;
  category: string;
  sort_order: string;
  is_available: boolean;
  station: PrintStation;
};
const EMPTY: Draft = {
  name_en: '',
  name_zh: '',
  price: '',
  cost_price: '',
  category: 'Steamed',
  sort_order: '0',
  is_available: true,
  station: 'kitchen',
};

export default function AdminMenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .order('category')
      .order('sort_order')
      .order('id');
    if (error) setErr(error.message);
    else setItems((data ?? []) as MenuItem[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, MenuItem[]>();
    for (const i of items) {
      const c = i.category || 'Other';
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(i);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  function startAdd() {
    setDraft({ ...EMPTY });
    setErr(null);
  }
  function startEdit(item: MenuItem) {
    setDraft({
      id: item.id,
      name_en: item.name_en,
      name_zh: item.name_zh ?? '',
      price: String(item.price),
      cost_price: String(item.cost_price ?? 0),
      category: item.category || 'Other',
      sort_order: String(item.sort_order ?? 0),
      is_available: item.is_available !== false,
      station: item.station ?? 'kitchen',
    });
    setErr(null);
  }

  async function save() {
    if (!draft) return;
    if (!draft.name_en.trim()) return setErr('English name is required');
    const priceNum = Number(draft.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) return setErr('Price must be a non-negative number');
    setSaving(true);
    setErr(null);
    const costNum = Number(draft.cost_price) || 0;
    if (costNum < 0) return setErr('Cost price cannot be negative');

    const payload = {
      name_en: draft.name_en.trim(),
      name_zh: draft.name_zh.trim() || null,
      price: priceNum,
      cost_price: costNum,
      category: draft.category.trim() || 'Other',
      sort_order: Number(draft.sort_order) || 0,
      is_available: draft.is_available,
      station: draft.station,
    };
    const { error } = draft.id
      ? await supabase.from('menu_items').update(payload).eq('id', draft.id)
      : await supabase.from('menu_items').insert(payload);
    setSaving(false);
    if (error) return setErr(error.message);
    setDraft(null);
    load();
  }

  async function toggleAvailability(item: MenuItem) {
    await supabase.from('menu_items').update({ is_available: !item.is_available }).eq('id', item.id);
    load();
  }
  async function del(item: MenuItem) {
    if (!confirm(`Delete "${item.name_en}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('menu_items').delete().eq('id', item.id);
    if (error) return alert('Delete failed: ' + error.message);
    load();
  }

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1200px] mx-auto px-4 md:px-6 py-6">
      <header className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <a href="/admin" className="text-xs uppercase tracking-widest text-[var(--ink-500)] hover:text-[var(--brand-600)]">
            ← Dashboard
          </a>
          <h1 className="text-3xl md:text-4xl font-bold text-[var(--ink-900)] mt-2">
            Menu · 菜單
          </h1>
        </div>
        <button
          onClick={startAdd}
          className="text-white font-bold px-5 py-3 rounded-2xl transition"
          style={{
            background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
            boxShadow: 'var(--shadow-brand)',
          }}
        >
          + Add item
        </button>
      </header>

      {err && !draft && (
        <div className="bg-[var(--brand-50)] border border-[var(--brand-100)] text-[var(--brand-700)] p-3 rounded-xl mb-4 text-sm">
          {err}
        </div>
      )}

      {loading ? (
        <p className="text-[var(--ink-500)]">Loading menu…</p>
      ) : grouped.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-3 opacity-40">🥟</div>
          <p className="text-lg text-[var(--ink-700)] font-semibold">No menu items yet</p>
          <p className="text-sm text-[var(--ink-500)] mt-1">Tap "Add item" to create the first one.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([category, list]) => (
            <section
              key={category}
              className="bg-white rounded-3xl border border-[var(--ink-200)] overflow-hidden"
              style={{ boxShadow: 'var(--shadow-sm)' }}
            >
              <div
                className="px-5 py-3 flex items-baseline justify-between"
                style={{
                  background: 'linear-gradient(90deg, var(--cream-100), var(--cream-50))',
                  borderBottom: '1px solid var(--ink-100)',
                }}
              >
                <h2 className="text-sm font-bold text-[var(--ink-800)] uppercase tracking-widest">
                  {category}
                </h2>
                <span className="text-xs text-[var(--ink-400)] font-mono">{list.length}</span>
              </div>
              <ul className="divide-y divide-[var(--ink-100)]">
                {list.map((item) => (
                  <li
                    key={item.id}
                    className={`flex flex-wrap items-center gap-3 px-5 py-4 ${
                      item.is_available ? '' : 'bg-[var(--ink-100)]/50 opacity-60'
                    }`}
                  >
                    <div className="flex-1 min-w-[220px]">
                      <div className="font-bold text-[var(--ink-900)]">{item.name_en}</div>
                      {item.name_zh && (
                        <div className="text-sm text-[var(--ink-500)]">{item.name_zh}</div>
                      )}
                    </div>
                    <div
                      className="text-[10px] px-2 py-1 rounded-lg font-bold uppercase tracking-widest"
                      style={
                        item.station === 'bar'
                          ? { background: 'rgb(6 95 70 / 0.15)', color: 'var(--jade-600)' }
                          : { background: 'var(--brand-50)', color: 'var(--brand-700)' }
                      }
                    >
                      {item.station === 'bar' ? '🫖 Bar' : '👨‍🍳 Kitchen'}
                    </div>
                    <div className="font-mono text-right w-36">
                      <div className="text-[var(--brand-700)] font-semibold">
                        RM {Number(item.price).toFixed(2)}
                      </div>
                      <MarginBadge price={Number(item.price)} cost={Number(item.cost_price)} />
                    </div>
                    <button
                      onClick={() => toggleAvailability(item)}
                      className={`text-[10px] px-3 py-1.5 rounded-lg font-bold uppercase tracking-widest ${
                        item.is_available
                          ? 'bg-[var(--jade-100)] text-[var(--jade-600)]'
                          : 'bg-[var(--ink-200)] text-[var(--ink-500)]'
                      }`}
                    >
                      {item.is_available ? 'Available' : 'Sold out'}
                    </button>
                    <button
                      onClick={() => startEdit(item)}
                      className="text-xs px-3 py-2 rounded-lg bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-[var(--ink-800)] font-bold"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => del(item)}
                      className="text-xs px-3 py-2 rounded-lg bg-[var(--brand-50)] hover:bg-[var(--brand-100)] text-[var(--brand-700)] font-bold"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {draft && (
        <div
          className="fixed inset-0 bg-[var(--ink-900)]/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => !saving && setDraft(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full p-6 animate-rise"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: 'var(--shadow-lg)' }}
          >
            <h2 className="text-xl font-bold text-[var(--ink-900)] mb-5">
              {draft.id ? 'Edit item' : 'Add item'}
            </h2>

            <Field label="English name">
              <input
                autoFocus
                value={draft.name_en}
                onChange={(e) => setDraft({ ...draft, name_en: e.target.value })}
                className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
              />
            </Field>

            <Field label="Chinese name (中文)">
              <input
                value={draft.name_zh}
                onChange={(e) => setDraft({ ...draft, name_zh: e.target.value })}
                className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Selling price (RM)">
                <input
                  type="number"
                  step="0.10"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl font-mono focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
                />
              </Field>
              <Field label="Cost / Modal 本錢 (RM)">
                <input
                  type="number"
                  step="0.10"
                  value={draft.cost_price}
                  onChange={(e) => setDraft({ ...draft, cost_price: e.target.value })}
                  placeholder="0.00"
                  className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl font-mono focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
                />
              </Field>
            </div>

            {draft.price && draft.cost_price && Number(draft.cost_price) > 0 && (
              <div
                className="mb-3 rounded-xl p-3 text-center text-sm"
                style={{ background: 'linear-gradient(135deg, var(--cream-100), var(--cream-200))' }}
              >
                <span className="text-[var(--ink-600)]">Profit per unit: </span>
                <span className="font-mono font-bold text-[var(--jade-600)]">
                  RM {Math.max(0, Number(draft.price) - Number(draft.cost_price)).toFixed(2)}
                </span>
                <span className="text-[var(--ink-500)] ml-2">
                  ({calcMargin(Number(draft.price), Number(draft.cost_price)).toFixed(0)}% margin)
                </span>
              </div>
            )}

            <Field label="Sort order">
              <input
                type="number"
                value={draft.sort_order}
                onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })}
                className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl font-mono focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
              />
            </Field>

            <Field label="Category">
              <input
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                list="cat-suggestions"
                className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
              />
              <datalist id="cat-suggestions">
                <option value="Steamed" />
                <option value="Fried" />
                <option value="Rice Noodle" />
                <option value="Congee" />
                <option value="Rice" />
                <option value="Drinks" />
                <option value="Dessert" />
                <option value="Other" />
              </datalist>
            </Field>

            <Field label="Prep station (which printer)">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, station: 'kitchen' })}
                  className={`py-3 rounded-xl font-bold text-sm transition ${
                    draft.station === 'kitchen'
                      ? 'text-white'
                      : 'bg-[var(--cream-100)] text-[var(--ink-700)] hover:bg-[var(--cream-200)]'
                  }`}
                  style={
                    draft.station === 'kitchen'
                      ? {
                          background:
                            'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
                          boxShadow: 'var(--shadow-brand)',
                        }
                      : undefined
                  }
                >
                  👨‍🍳 Kitchen · 廚房
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, station: 'bar' })}
                  className={`py-3 rounded-xl font-bold text-sm transition ${
                    draft.station === 'bar'
                      ? 'text-white'
                      : 'bg-[var(--cream-100)] text-[var(--ink-700)] hover:bg-[var(--cream-200)]'
                  }`}
                  style={
                    draft.station === 'bar'
                      ? {
                          background:
                            'linear-gradient(135deg, var(--jade-500), var(--jade-600))',
                          boxShadow: '0 10px 24px -8px rgb(5 150 105 / 0.35)',
                        }
                      : undefined
                  }
                >
                  🫖 Bar · 水吧
                </button>
              </div>
              <span className="text-xs text-[var(--ink-400)]">
                Food goes to the kitchen printer; drinks go to the bar printer.
              </span>
            </Field>

            <label className="flex items-center gap-2 mb-5 text-sm text-[var(--ink-800)] cursor-pointer">
              <input
                type="checkbox"
                checked={draft.is_available}
                onChange={(e) => setDraft({ ...draft, is_available: e.target.checked })}
                className="w-4 h-4 accent-[var(--brand-600)]"
              />
              Available on POS
            </label>

            {err && (
              <div className="bg-[var(--brand-50)] border border-[var(--brand-100)] text-[var(--brand-700)] p-2 rounded-xl mb-4 text-sm">
                {err}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setDraft(null)}
                disabled={saving}
                className="w-full bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-[var(--ink-800)] font-bold py-3 rounded-2xl"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="w-full text-white font-bold py-3 rounded-2xl disabled:opacity-60"
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
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-1.5 font-semibold">
        {label}
      </span>
      {children}
    </label>
  );
}

function MarginBadge({ price, cost }: { price: number; cost: number }) {
  if (!cost || cost <= 0) {
    return (
      <div className="text-[10px] text-[var(--ink-400)] mt-0.5">
        modal not set
      </div>
    );
  }
  const margin = calcMargin(price, cost);
  const color =
    margin >= 60 ? 'var(--jade-600)'
    : margin >= 30 ? 'var(--gold-600)'
    : 'var(--brand-700)';
  return (
    <div className="text-[10px] mt-0.5 flex justify-end gap-1.5">
      <span className="text-[var(--ink-400)]">cost RM {cost.toFixed(2)}</span>
      <span style={{ color }} className="font-bold">
        · {margin.toFixed(0)}%
      </span>
    </div>
  );
}

function calcMargin(price: number, cost: number): number {
  if (!price || price <= 0) return 0;
  return ((price - cost) / price) * 100;
}
