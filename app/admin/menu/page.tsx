'use client';

// Admin menu management: list items grouped by category, add / edit /
// toggle availability / delete. Live-updates for every open POS terminal.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { MenuItem } from '@/lib/types';

type Draft = {
  id?: number;
  name_en: string;
  name_zh: string;
  price: string;
  category: string;
  sort_order: string;
  is_available: boolean;
};

const EMPTY: Draft = {
  name_en: '',
  name_zh: '',
  price: '',
  category: 'Steamed',
  sort_order: '0',
  is_available: true,
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
    if (error) {
      setErr(error.message);
    } else {
      setItems((data ?? []) as MenuItem[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

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
      category: item.category || 'Other',
      sort_order: String(item.sort_order ?? 0),
      is_available: item.is_available !== false,
    });
    setErr(null);
  }

  async function save() {
    if (!draft) return;
    if (!draft.name_en.trim()) {
      setErr('English name is required');
      return;
    }
    const priceNum = Number(draft.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setErr('Price must be a non-negative number');
      return;
    }

    setSaving(true);
    setErr(null);

    const payload = {
      name_en: draft.name_en.trim(),
      name_zh: draft.name_zh.trim() || null,
      price: priceNum,
      category: draft.category.trim() || 'Other',
      sort_order: Number(draft.sort_order) || 0,
      is_available: draft.is_available,
    };

    const { error } = draft.id
      ? await supabase.from('menu_items').update(payload).eq('id', draft.id)
      : await supabase.from('menu_items').insert(payload);

    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setDraft(null);
    load();
  }

  async function toggleAvailability(item: MenuItem) {
    await supabase
      .from('menu_items')
      .update({ is_available: !item.is_available })
      .eq('id', item.id);
    load();
  }

  async function del(item: MenuItem) {
    if (!confirm(`Delete "${item.name_en}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('menu_items').delete().eq('id', item.id);
    if (error) {
      alert('Delete failed: ' + error.message);
      return;
    }
    load();
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-50 p-6">
        <p>Loading menu…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 p-4 md:p-8">
      <header className="flex justify-between items-center mb-6">
        <div>
          <a href="/admin" className="text-sm text-stone-500 hover:text-red-700">
            ← Back to dashboard
          </a>
          <h1 className="text-3xl font-bold text-stone-800">🥟 Menu</h1>
        </div>
        <button
          onClick={startAdd}
          className="bg-red-700 hover:bg-red-800 text-white font-bold px-4 py-2 rounded"
        >
          + Add item
        </button>
      </header>

      {err && !draft && (
        <p className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">{err}</p>
      )}

      <div className="space-y-6">
        {grouped.map(([category, list]) => (
          <section
            key={category}
            className="bg-white rounded-lg border border-stone-200 overflow-hidden"
          >
            <h2 className="text-lg font-bold text-stone-800 px-4 py-3 bg-stone-100 border-b border-stone-200">
              {category}
            </h2>
            <ul className="divide-y divide-stone-100">
              {list.map((item) => (
                <li
                  key={item.id}
                  className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
                    item.is_available ? '' : 'bg-stone-50 opacity-60'
                  }`}
                >
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-bold text-stone-800">{item.name_en}</div>
                    {item.name_zh && (
                      <div className="text-sm text-stone-500">{item.name_zh}</div>
                    )}
                  </div>
                  <div className="font-mono text-red-700 w-24 text-right">
                    RM {Number(item.price).toFixed(2)}
                  </div>
                  <button
                    onClick={() => toggleAvailability(item)}
                    className={`text-xs px-2 py-1 rounded font-bold ${
                      item.is_available
                        ? 'bg-green-100 text-green-800 hover:bg-green-200'
                        : 'bg-stone-200 text-stone-600 hover:bg-stone-300'
                    }`}
                  >
                    {item.is_available ? 'Available' : 'Sold out'}
                  </button>
                  <button
                    onClick={() => startEdit(item)}
                    className="text-xs px-3 py-1 rounded bg-stone-100 text-stone-700 hover:bg-stone-200 font-bold"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => del(item)}
                    className="text-xs px-3 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 font-bold"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {grouped.length === 0 && (
          <div className="text-center text-stone-400 py-16">
            <p>No menu items yet. Tap “Add item” to create the first one.</p>
          </div>
        )}
      </div>

      {/* EDIT / ADD MODAL */}
      {draft && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
          onClick={() => !saving && setDraft(null)}
        >
          <div
            className="bg-white rounded-lg max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-4">
              {draft.id ? 'Edit item' : 'Add item'}
            </h2>

            <Field label="English name">
              <input
                autoFocus
                value={draft.name_en}
                onChange={(e) => setDraft({ ...draft, name_en: e.target.value })}
                className="w-full px-3 py-2 border border-stone-300 rounded"
              />
            </Field>

            <Field label="Chinese name (中文)">
              <input
                value={draft.name_zh}
                onChange={(e) => setDraft({ ...draft, name_zh: e.target.value })}
                className="w-full px-3 py-2 border border-stone-300 rounded"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Price (RM)">
                <input
                  type="number"
                  step="0.10"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 rounded font-mono"
                />
              </Field>
              <Field label="Sort order">
                <input
                  type="number"
                  value={draft.sort_order}
                  onChange={(e) =>
                    setDraft({ ...draft, sort_order: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-stone-300 rounded font-mono"
                />
              </Field>
            </div>

            <Field label="Category">
              <input
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                list="cat-suggestions"
                className="w-full px-3 py-2 border border-stone-300 rounded"
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

            <label className="flex items-center gap-2 mb-4 text-sm">
              <input
                type="checkbox"
                checked={draft.is_available}
                onChange={(e) =>
                  setDraft({ ...draft, is_available: e.target.checked })
                }
              />
              Available on POS
            </label>

            {err && (
              <p className="bg-red-50 text-red-700 p-2 rounded mb-3 text-sm">
                {err}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setDraft(null)}
                disabled={saving}
                className="flex-1 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold py-2 rounded"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 bg-red-700 hover:bg-red-800 disabled:bg-stone-300 text-white font-bold py-2 rounded"
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block mb-3">
      <span className="block text-sm text-stone-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
