'use client';

// Admin settings — the single shop_settings row. Edits go live everywhere
// (POS terminal, cashier, printer) via Supabase Realtime.

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

    const { error } = await supabase
      .from('shop_settings')
      .update(patch)
      .eq('id', 1);

    setSaving(false);
    if (error) {
      setErr(error.message);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  if (!draft) {
    return (
      <main className="min-h-screen bg-stone-50 p-6">
        <p>Loading settings…</p>
      </main>
    );
  }

  // Live preview: how the tax breakdown looks on a RM 100 subtotal.
  const preview = computeBreakdown(100, {
    sst_pct: Number(draft.sst_pct) || 0,
    service_charge_pct: Number(draft.service_charge_pct) || 0,
    round_to_5_sen: draft.round_to_5_sen,
  });

  return (
    <main className="min-h-screen bg-stone-50 p-4 md:p-8">
      <header className="mb-6">
        <a href="/admin" className="text-sm text-stone-500 hover:text-red-700">
          ← Back to dashboard
        </a>
        <h1 className="text-3xl font-bold text-stone-800">⚙️ Settings</h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
        <section className="bg-white rounded-lg p-6 border border-stone-200">
          <h2 className="text-lg font-bold text-stone-800 mb-4">Shop</h2>

          <Field label="Shop name (English)">
            <input
              value={draft.shop_name}
              onChange={(e) => setDraft({ ...draft, shop_name: e.target.value })}
              className="w-full px-3 py-2 border border-stone-300 rounded"
            />
          </Field>

          <Field label="Shop name (中文)">
            <input
              value={draft.shop_name_zh}
              onChange={(e) =>
                setDraft({ ...draft, shop_name_zh: e.target.value })
              }
              className="w-full px-3 py-2 border border-stone-300 rounded"
            />
          </Field>

          <Field label="Address (printed on receipts)">
            <textarea
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-stone-300 rounded"
            />
          </Field>
        </section>

        <section className="bg-white rounded-lg p-6 border border-stone-200">
          <h2 className="text-lg font-bold text-stone-800 mb-4">Tax & rounding</h2>

          <Field label="Service charge %">
            <input
              type="number"
              step="0.5"
              value={draft.service_charge_pct}
              onChange={(e) =>
                setDraft({ ...draft, service_charge_pct: e.target.value })
              }
              className="w-full px-3 py-2 border border-stone-300 rounded font-mono"
            />
            <span className="text-xs text-stone-400">
              Usually 0 (hawker) or 10 (sit-down restaurant).
            </span>
          </Field>

          <Field label="SST %">
            <input
              type="number"
              step="0.5"
              value={draft.sst_pct}
              onChange={(e) => setDraft({ ...draft, sst_pct: e.target.value })}
              className="w-full px-3 py-2 border border-stone-300 rounded font-mono"
            />
            <span className="text-xs text-stone-400">
              6% for F&amp;B if you cross the SST threshold. Otherwise 0.
            </span>
          </Field>

          <label className="flex items-center gap-2 mb-4 text-sm">
            <input
              type="checkbox"
              checked={draft.round_to_5_sen}
              onChange={(e) =>
                setDraft({ ...draft, round_to_5_sen: e.target.checked })
              }
            />
            Round cash totals to nearest 5 sen
          </label>

          {/* PREVIEW */}
          <div className="bg-stone-50 border border-stone-200 rounded p-3 text-sm space-y-1">
            <p className="text-xs uppercase tracking-wider text-stone-500 mb-1">
              Preview on RM 100 subtotal
            </p>
            <Row label="Subtotal" value={preview.subtotal} />
            {preview.service_charge > 0 && (
              <Row
                label={`Service ${draft.service_charge_pct}%`}
                value={preview.service_charge}
              />
            )}
            {preview.tax > 0 && (
              <Row label={`SST ${draft.sst_pct}%`} value={preview.tax} />
            )}
            {preview.rounding !== 0 && (
              <Row label="Rounding" value={preview.rounding} />
            )}
            <div className="flex justify-between font-bold border-t border-stone-200 pt-1 mt-1">
              <span>Total</span>
              <span className="font-mono text-red-700">
                RM {preview.total.toFixed(2)}
              </span>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-6 max-w-4xl flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="bg-red-700 hover:bg-red-800 disabled:bg-stone-300 text-white font-bold px-6 py-3 rounded"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span className="text-green-700 text-sm">✓ Saved</span>}
        {err && <span className="text-red-700 text-sm">{err}</span>}
      </div>
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

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-stone-600">
      <span>{label}</span>
      <span className="font-mono">RM {value.toFixed(2)}</span>
    </div>
  );
}
