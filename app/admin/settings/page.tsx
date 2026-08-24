'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchSettings } from '@/lib/settings';
import { computeBreakdown } from '@/lib/pricing';
import type { ShopSettings } from '@/lib/types';

type Draft = {
  shop_name: string;
  shop_name_zh: string;
  address: string;
  sst_pct: string;
  service_charge_pct: string;
  round_to_5_sen: boolean;
};

export default function AdminSettingsPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings().then((s) => {
      setDraft({
        shop_name: s.shop_name,
        shop_name_zh: s.shop_name_zh,
        address: s.address,
        sst_pct: String(s.sst_pct),
        service_charge_pct: String(s.service_charge_pct),
        round_to_5_sen: s.round_to_5_sen,
      });
    });
  }, []);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setErr(null);
    setSaved(false);
    const patch: Partial<ShopSettings> = {
      shop_name: draft.shop_name.trim() || 'DIM SUM SHOP',
      shop_name_zh: draft.shop_name_zh.trim(),
      address: draft.address.trim(),
      sst_pct: Number(draft.sst_pct) || 0,
      service_charge_pct: Number(draft.service_charge_pct) || 0,
      round_to_5_sen: draft.round_to_5_sen,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('shop_settings').update(patch).eq('id', 1);
    setSaving(false);
    if (error) return setErr(error.message);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (!draft) {
    return (
      <main className="min-h-[calc(100vh-56px)] max-w-[1200px] mx-auto px-4 md:px-6 py-6">
        <p className="text-[var(--ink-500)]">Loading settings…</p>
      </main>
    );
  }

  const preview = computeBreakdown(100, {
    sst_pct: Number(draft.sst_pct) || 0,
    service_charge_pct: Number(draft.service_charge_pct) || 0,
    round_to_5_sen: draft.round_to_5_sen,
  });

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1200px] mx-auto px-4 md:px-6 py-6">
      <header className="mb-6">
        <a href="/admin" className="text-xs uppercase tracking-widest text-[var(--ink-500)] hover:text-[var(--brand-600)]">
          ← Dashboard
        </a>
        <h1 className="text-3xl md:text-4xl font-bold text-[var(--ink-900)] mt-2">
          Settings · 設定
        </h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-3xl p-6 border border-[var(--ink-200)]" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <h2 className="text-lg font-bold text-[var(--ink-900)] mb-5">Shop</h2>

          <Field label="Shop name (English)">
            <input
              value={draft.shop_name}
              onChange={(e) => setDraft({ ...draft, shop_name: e.target.value })}
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
          </Field>

          <Field label="Shop name (中文)">
            <input
              value={draft.shop_name_zh}
              onChange={(e) => setDraft({ ...draft, shop_name_zh: e.target.value })}
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
          </Field>

          <Field label="Address (printed on receipts)">
            <textarea
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              rows={3}
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
          </Field>
        </section>

        <section className="bg-white rounded-3xl p-6 border border-[var(--ink-200)]" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <h2 className="text-lg font-bold text-[var(--ink-900)] mb-5">Tax & rounding</h2>

          <Field label="Service charge %">
            <input
              type="number"
              step="0.5"
              value={draft.service_charge_pct}
              onChange={(e) => setDraft({ ...draft, service_charge_pct: e.target.value })}
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl font-mono focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
            <span className="text-xs text-[var(--ink-400)]">
              Usually 0 (hawker) or 10 (sit-down restaurant).
            </span>
          </Field>

          <Field label="SST %">
            <input
              type="number"
              step="0.5"
              value={draft.sst_pct}
              onChange={(e) => setDraft({ ...draft, sst_pct: e.target.value })}
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl font-mono focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
            <span className="text-xs text-[var(--ink-400)]">
              6% for F&amp;B if you cross the SST threshold. Otherwise 0.
            </span>
          </Field>

          <label className="flex items-center gap-2 mb-5 text-sm text-[var(--ink-800)] cursor-pointer">
            <input
              type="checkbox"
              checked={draft.round_to_5_sen}
              onChange={(e) => setDraft({ ...draft, round_to_5_sen: e.target.checked })}
              className="w-4 h-4 accent-[var(--brand-600)]"
            />
            Round cash totals to nearest 5 sen
          </label>

          <div className="bg-[var(--cream-100)] border border-[var(--cream-300)] rounded-2xl p-4 text-sm">
            <p className="text-[10px] uppercase tracking-widest text-[var(--ink-500)] mb-2 font-semibold">
              Preview on RM 100 subtotal
            </p>
            <div className="space-y-1">
              <PR label="Subtotal" value={preview.subtotal} />
              {preview.service_charge > 0 && (
                <PR label={`Service ${draft.service_charge_pct}%`} value={preview.service_charge} />
              )}
              {preview.tax > 0 && <PR label={`SST ${draft.sst_pct}%`} value={preview.tax} />}
              {preview.rounding !== 0 && <PR label="Rounding" value={preview.rounding} />}
              <div className="flex justify-between text-base font-bold border-t border-[var(--cream-300)] pt-1 mt-1">
                <span className="text-[var(--ink-800)]">Total</span>
                <span className="font-mono text-[var(--brand-700)]">RM {preview.total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="text-white font-bold px-6 py-3 rounded-2xl disabled:opacity-60"
          style={{
            background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
            boxShadow: 'var(--shadow-brand)',
          }}
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && (
          <span className="text-[var(--jade-600)] text-sm font-semibold">✓ Saved</span>
        )}
        {err && <span className="text-[var(--brand-700)] text-sm">{err}</span>}
      </div>
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

function PR({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-[var(--ink-600)]">
      <span>{label}</span>
      <span className="font-mono">RM {value.toFixed(2)}</span>
    </div>
  );
}
