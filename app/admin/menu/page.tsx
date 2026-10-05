'use client';

// Menu management — redesigned. Category bands, item rows, modal editor.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminPageHeader, PrimaryBtn, SecondaryBtn, ErrorBanner, EmptyState } from '@/components/ui';
import { SUGGESTED_MODIFIERS, MENU_CATEGORIES, stationForCategory, type ItemModifier, type MenuItem, type PrintStation } from '@/lib/types';

// Display metadata for the printer each category routes to.  Routing itself
// lives in stationForCategory(); this is only for the admin badges/editor.
const STATION_META: Record<PrintStation, { label: string; emoji: string; bg: string; fg: string }> = {
  kitchen: { label: 'Back Kitchen 後廚',  emoji: '👨‍🍳', bg: 'var(--brand-50)',      fg: 'var(--brand-700)' },
  cashier: { label: 'Front Kitchen 前廚', emoji: '🧾',   bg: 'var(--gold-400)/15',   fg: 'var(--gold-600)' },
  bar:     { label: 'Bar 水吧',           emoji: '🫖',   bg: 'rgb(6 95 70 / 0.15)',  fg: 'var(--jade-600)' },
};

type Draft = {
  id?: number;
  name_en: string;
  name_zh: string;
  price: string;
  image_url: string;
  options_available: ItemModifier[];
  category: string;
  sort_order: string;
  is_available: boolean;
  temporarily_disabled: boolean;
  station: PrintStation;
};
const EMPTY: Draft = {
  name_en: '',
  name_zh: '',
  price: '',
  image_url: '',
  options_available: [],
  category: 'Dim Sum',
  sort_order: '0',
  is_available: true,
  temporarily_disabled: false,
  station: 'cashier',
};

export default function AdminMenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function uploadImageFile(file: File): Promise<string> {
    const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
    // Prefix with timestamp so filenames don't collide.
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from('menu-photos')
      .upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from('menu-photos').getPublicUrl(path);
    return data.publicUrl;
  }

  async function pickImage(file: File | null) {
    if (!draft || !file) return;
    if (!file.type.startsWith('image/')) {
      setErr('Please pick an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr('Image is too big (5 MB max)');
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      const url = await uploadImageFile(file);
      setDraft({ ...draft, image_url: url });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }
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
    // Sort in the seven-category order defined in lib/types, with any
    // unrecognised categories appended at the end alphabetically.
    const order = MENU_CATEGORIES.map((c) => c.key);
    return [...m.entries()].sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
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
      image_url: item.image_url ?? '',
      options_available: Array.isArray(item.options_available) ? item.options_available : [],
      category: item.category || 'Other',
      sort_order: String(item.sort_order ?? 0),
      is_available: item.is_available !== false,
      temporarily_disabled: item.temporarily_disabled === true,
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
    const payload = {
      name_en: draft.name_en.trim(),
      name_zh: draft.name_zh.trim() || null,
      price: priceNum,
      image_url: draft.image_url.trim() || null,
      options_available: draft.options_available,
      category: draft.category.trim() || 'Other',
      sort_order: Number(draft.sort_order) || 0,
      is_available: draft.is_available,
      temporarily_disabled: draft.temporarily_disabled,
      // Station is DERIVED from the category so it always matches the printer
      // the item routes to (Noodles → kitchen, Drinks → bar, else → cashier).
      station: stationForCategory(draft.category.trim() || 'Other'),
    };
    const { error } = draft.id
      ? await supabase.from('menu_items').update(payload).eq('id', draft.id)
      : await supabase.from('menu_items').insert(payload);
    setSaving(false);
    if (error) return setErr(error.message);
    setDraft(null);
    load();
  }

  async function toggleTempOff(item: MenuItem) {
    // Toggling the "sold out today" flag, not the permanent availability.
    await supabase
      .from('menu_items')
      .update({ temporarily_disabled: !item.temporarily_disabled })
      .eq('id', item.id);
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
      <AdminPageHeader
        title="Menu"
        titleZh="菜單"
        right={
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
        }
      />

      {err && !draft && <ErrorBanner>{err}</ErrorBanner>}

      {loading ? (
        <p className="text-[var(--ink-500)]">Loading menu…</p>
      ) : grouped.length === 0 ? (
        <EmptyState emoji="🥟" title="No menu items yet" sub='Tap "Add item" to create the first one.' />
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
                <h2 className="text-sm font-bold text-[var(--ink-800)] uppercase tracking-widest flex items-center gap-2">
                  {(() => {
                    const meta = MENU_CATEGORIES.find((c) => c.key === category);
                    return meta ? (
                      <>
                        <span className="text-lg">{meta.emoji}</span>
                        <span>{meta.label}</span>
                        <span className="text-[var(--ink-500)] font-normal normal-case tracking-normal">
                          · {meta.label_zh}
                        </span>
                      </>
                    ) : (
                      <span>{category}</span>
                    );
                  })()}
                </h2>
                <span className="text-xs text-[var(--ink-400)] font-mono">{list.length}</span>
              </div>
              <ul className="divide-y divide-[var(--ink-100)]">
                {list.map((item) => (
                  <li
                    key={item.id}
                    className={`flex flex-wrap items-center gap-3 px-5 py-4 ${
                      !item.is_available
                        ? 'bg-[var(--ink-100)]/50 opacity-60'
                        : item.temporarily_disabled
                        ? 'bg-[var(--gold-300)]/15'
                        : ''
                    }`}
                  >
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt=""
                        className="w-12 h-12 rounded-xl object-cover border border-[var(--ink-100)]"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-[var(--cream-100)] border border-[var(--ink-100)] flex items-center justify-center text-lg opacity-40">
                        {STATION_META[stationForCategory(item.category)].emoji}
                      </div>
                    )}
                    <div className="flex-1 min-w-[200px]">
                      <div className="font-bold text-[var(--ink-900)]">{item.name_en}</div>
                      {item.name_zh && (
                        <div className="text-sm text-[var(--ink-500)]">{item.name_zh}</div>
                      )}
                    </div>
                    {(() => {
                      const meta = STATION_META[stationForCategory(item.category)];
                      return (
                        <div
                          className="text-[10px] px-2 py-1 rounded-lg font-bold uppercase tracking-widest"
                          style={{ background: meta.bg, color: meta.fg }}
                        >
                          {meta.emoji} {meta.label}
                        </div>
                      );
                    })()}
                    <div className="font-mono text-[var(--brand-700)] font-semibold w-24 text-right">
                      RM {Number(item.price).toFixed(2)}
                    </div>
                    <button
                      onClick={() => toggleTempOff(item)}
                      title="Toggle sold-out-today"
                      className={`text-[10px] px-3 py-1.5 rounded-lg font-bold uppercase tracking-widest ${
                        !item.is_available
                          ? 'bg-[var(--ink-200)] text-[var(--ink-500)]'
                          : item.temporarily_disabled
                          ? 'bg-[var(--gold-400)] text-[var(--ink-900)]'
                          : 'bg-[var(--jade-100)] text-[var(--jade-600)]'
                      }`}
                    >
                      {!item.is_available
                        ? 'Hidden'
                        : item.temporarily_disabled
                        ? '售罄 Sold out'
                        : 'Selling'}
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
            className="bg-white rounded-3xl max-w-md w-full flex flex-col max-h-[95vh] animate-rise overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: 'var(--shadow-lg)' }}
          >
            {/* Sticky header */}
            <div className="shrink-0 px-6 pt-6 pb-3 border-b border-[var(--ink-100)]">
              <h2 className="text-xl font-bold text-[var(--ink-900)]">
                {draft.id ? 'Edit item' : 'Add item'}
              </h2>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 px-6 py-4">

            {/* Image uploader */}
            <div className="mb-4">
              <span className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-1.5 font-semibold">
                Photo
              </span>
              <div className="flex items-center gap-3">
                {draft.image_url ? (
                  <div className="relative w-24 h-24 rounded-2xl overflow-hidden border border-[var(--ink-200)] shrink-0">
                    <img
                      src={draft.image_url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    {uploading && (
                      <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-xs">
                        Uploading…
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-2xl bg-[var(--cream-100)] border-2 border-dashed border-[var(--ink-200)] flex items-center justify-center text-3xl opacity-40 shrink-0">
                    📷
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-2">
                  <label
                    className={`inline-block cursor-pointer px-4 py-2 rounded-xl font-bold text-sm transition ${
                      uploading
                        ? 'bg-[var(--ink-200)] text-[var(--ink-500)]'
                        : 'bg-[var(--brand-600)] hover:bg-[var(--brand-700)] text-white'
                    }`}
                  >
                    {uploading ? 'Uploading…' : draft.image_url ? 'Change photo' : 'Upload photo'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        pickImage(f ?? null);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {draft.image_url && !uploading && (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, image_url: '' })}
                      className="block text-xs text-[var(--ink-500)] hover:text-[var(--brand-600)] font-semibold"
                    >
                      Remove photo
                    </button>
                  )}
                  <p className="text-[10px] text-[var(--ink-400)]">
                    JPG, PNG, WebP or GIF. 5 MB max.
                  </p>
                </div>
              </div>
            </div>

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
              <Field label="Price (RM)">
                <input
                  type="number"
                  step="0.10"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl font-mono focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
                />
              </Field>
              <Field label="Sort order">
                <input
                  type="number"
                  value={draft.sort_order}
                  onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })}
                  className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl font-mono focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
                />
              </Field>
            </div>

            <Field label="Category · 分類">
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl bg-white focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
              >
                {MENU_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.emoji}  {c.label} · {c.label_zh}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Prints at (set by category)">
              {(() => {
                const meta = STATION_META[stationForCategory(draft.category)];
                return (
                  <div
                    className="flex items-center gap-2 py-3 px-4 rounded-xl font-bold text-sm"
                    style={{ background: meta.bg, color: meta.fg }}
                  >
                    <span>{meta.emoji}</span>
                    <span>{meta.label}</span>
                    <span className="ml-auto text-xs font-normal opacity-70">auto</span>
                  </div>
                );
              })()}
              <span className="text-xs text-[var(--ink-400)]">
                Noodles &amp; Fried → Back Kitchen · Drinks → Bar · everything
                else (dim sum, buns, rice, roasted…) → Front Kitchen.
              </span>
            </Field>

            {/* Per-item modifiers */}
            <div className="mb-4 min-w-0">
              <span className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-2 font-semibold">
                Modifiers for this item
              </span>

              {/* Current list */}
              {draft.options_available.length > 0 ? (
                <div className="flex flex-wrap gap-2 mb-3 min-w-0">
                  {draft.options_available.map((mod, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold text-white max-w-full"
                      style={{
                        background: 'linear-gradient(135deg, var(--gold-500), var(--brand-600))',
                      }}
                    >
                      <span className="min-w-0 break-words">
                        {mod.label}
                        {mod.label_zh && <span className="opacity-90"> · {mod.label_zh}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            options_available: draft.options_available.filter((_, i) => i !== idx),
                          })
                        }
                        className="w-4 h-4 rounded-full bg-white/20 hover:bg-white/40 text-white text-[10px] flex items-center justify-center shrink-0"
                        aria-label="Remove modifier"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--ink-400)] mb-3">
                  No modifiers yet. Add custom ones or tap a suggestion below.
                </p>
              )}

              {/* Custom entry */}
              <ModifierAdder
                onAdd={(m) => {
                  if (draft.options_available.some((x) => x.label === m.label)) return;
                  setDraft({ ...draft, options_available: [...draft.options_available, m] });
                }}
              />

              {/* Suggestions row */}
              <p className="text-[10px] uppercase tracking-widest text-[var(--ink-400)] font-semibold mt-3 mb-2">
                Suggestions — tap to add
              </p>
              <div className="flex flex-wrap gap-1.5 min-w-0">
                {SUGGESTED_MODIFIERS.filter(
                  (s) => !draft.options_available.some((x) => x.label === s.label)
                ).map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        options_available: [...draft.options_available, s],
                      })
                    }
                    className="text-[10px] px-2.5 py-1 rounded-full bg-[var(--cream-100)] text-[var(--ink-700)] border border-[var(--ink-200)] hover:border-[var(--brand-400)] max-w-full break-words text-left"
                  >
                    + {s.label}
                    {s.label_zh && <span className="text-[var(--ink-400)]"> · {s.label_zh}</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 mb-5">
              <label className="flex items-start gap-3 text-sm text-[var(--ink-800)] cursor-pointer p-3 rounded-xl bg-[var(--cream-100)] border border-[var(--ink-100)]">
                <input
                  type="checkbox"
                  checked={draft.is_available}
                  onChange={(e) => setDraft({ ...draft, is_available: e.target.checked })}
                  className="w-4 h-4 accent-[var(--brand-600)] mt-0.5"
                />
                <span>
                  <b>Available on menu</b> <span className="text-[var(--ink-500)]">· 上架</span>
                  <span className="block text-xs text-[var(--ink-500)] font-normal mt-0.5">
                    Uncheck to permanently remove this item from the POS.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm text-[var(--ink-800)] cursor-pointer p-3 rounded-xl bg-[var(--gold-300)]/25 border border-[var(--gold-400)]/40">
                <input
                  type="checkbox"
                  checked={draft.temporarily_disabled}
                  onChange={(e) => setDraft({ ...draft, temporarily_disabled: e.target.checked })}
                  className="w-4 h-4 accent-[var(--gold-500)] mt-0.5"
                />
                <span>
                  <b>Sold out today</b> <span className="text-[var(--ink-500)]">· 今日售罄</span>
                  <span className="block text-xs text-[var(--ink-500)] font-normal mt-0.5">
                    Temporarily hides the item from POS without deleting it. Toggle off when back in stock.
                  </span>
                </span>
              </label>
            </div>

            {err && <ErrorBanner>{err}</ErrorBanner>}
            </div>

            {/* Sticky footer with Save/Cancel — always visible */}
            <div className="shrink-0 px-6 py-4 border-t border-[var(--ink-100)]">
              <div className="grid grid-cols-2 gap-2">
                <SecondaryBtn onClick={() => setDraft(null)} disabled={saving}>Cancel</SecondaryBtn>
                <PrimaryBtn onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </PrimaryBtn>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3 min-w-0">
      <span className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-1.5 font-semibold">
        {label}
      </span>
      {children}
    </label>
  );
}

// Small inline editor to add a custom modifier chip (English + optional Chinese).
function ModifierAdder({ onAdd }: { onAdd: (m: ItemModifier) => void }) {
  const [en, setEn] = useState('');
  const [zh, setZh] = useState('');

  function submit() {
    const label = en.trim();
    if (!label) return;
    onAdd({ label, label_zh: zh.trim() });
    setEn('');
    setZh('');
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 min-w-0">
      <input
        value={en}
        onChange={(e) => setEn(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
        placeholder="English"
        className="min-w-0 w-full px-3 py-2 border border-[var(--ink-200)] rounded-lg text-sm focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
      />
      <input
        value={zh}
        onChange={(e) => setZh(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
        placeholder="中文 (optional)"
        className="min-w-0 w-full px-3 py-2 border border-[var(--ink-200)] rounded-lg text-sm focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!en.trim()}
        className="px-4 py-2 rounded-lg text-white font-bold text-sm disabled:opacity-40"
        style={{ background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))' }}
      >
        Add
      </button>
    </div>
  );
}

