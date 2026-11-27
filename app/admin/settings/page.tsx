'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchSettings } from '@/lib/settings';
import { computeBreakdown } from '@/lib/pricing';
import { AdminPageHeader, FileUpload } from '@/components/ui';
import type { ShopSettings } from '@/lib/types';

type Draft = {
  shop_name: string;
  shop_name_zh: string;
  address: string;
  phone: string;
  tax_id: string;
  wifi_ssid: string;
  wifi_password: string;
  receipt_thank_you: string;
  receipt_come_again: string;
  sst_pct: string;
  service_charge_pct: string;
  round_to_5_sen: boolean;
};

export default function AdminSettingsPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    fetchSettings().then((s) => {
      setQrUrl(s.payment_qr_url ?? '');
      setDraft({
        shop_name: s.shop_name,
        shop_name_zh: s.shop_name_zh,
        address: s.address,
        phone: s.phone ?? '',
        tax_id: s.tax_id ?? '',
        wifi_ssid: s.wifi_ssid ?? '',
        wifi_password: s.wifi_password ?? '',
        receipt_thank_you: s.receipt_thank_you ?? '',
        receipt_come_again: s.receipt_come_again ?? '',
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
    // Clamp to a sane 0–100% range — an accidental negative or 4-digit
    // percentage here silently corrupts every receipt's tax/service charge
    // until someone notices.
    const clampPct = (v: string) => Math.min(100, Math.max(0, Number(v) || 0));
    const patch: Partial<ShopSettings> = {
      shop_name: draft.shop_name.trim() || 'DIM SUM SHOP',
      shop_name_zh: draft.shop_name_zh.trim(),
      address: draft.address.trim(),
      phone: draft.phone.trim(),
      tax_id: draft.tax_id.trim(),
      wifi_ssid: draft.wifi_ssid.trim(),
      wifi_password: draft.wifi_password.trim(),
      receipt_thank_you: draft.receipt_thank_you.trim(),
      receipt_come_again: draft.receipt_come_again.trim(),
      sst_pct: clampPct(draft.sst_pct),
      service_charge_pct: clampPct(draft.service_charge_pct),
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
      <AdminPageHeader title="Settings" />

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

          <Field label="Shop name (Chinese)">
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

          <Field label="Phone (printed on receipts)">
            <input
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
          </Field>

          <Field label="SST registration / Tax ID (printed on receipts)">
            <input
              value={draft.tax_id}
              onChange={(e) => setDraft({ ...draft, tax_id: e.target.value })}
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
            <span className="text-xs text-[var(--ink-400)]">Leave blank to leave it off the receipt.</span>
          </Field>

          <Field label="Wifi name (printed on receipts)">
            <input
              value={draft.wifi_ssid}
              onChange={(e) => setDraft({ ...draft, wifi_ssid: e.target.value })}
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
          </Field>

          <Field label="Wifi password">
            <input
              value={draft.wifi_password}
              onChange={(e) => setDraft({ ...draft, wifi_password: e.target.value })}
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
          </Field>

          <Field label="Receipt thank-you line">
            <input
              value={draft.receipt_thank_you}
              onChange={(e) => setDraft({ ...draft, receipt_thank_you: e.target.value })}
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
            <span className="text-xs text-[var(--ink-400)]">Blank uses &quot;Thank you for dining with us!&quot;.</span>
          </Field>

          <Field label="Receipt closing line">
            <input
              value={draft.receipt_come_again}
              onChange={(e) => setDraft({ ...draft, receipt_come_again: e.target.value })}
              className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            />
            <span className="text-xs text-[var(--ink-400)]">Blank uses &quot;Please Come Again Soon&quot;.</span>
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

      <PaymentQrSection url={qrUrl} onChange={setQrUrl} />

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

// ─── QR payment ───────────────────────────────────────────────────────────
// The shop's static payment QR (Touch 'n Go eWallet / DuitNow National QR)
// shown on the cashier's QR payment screen. Saved straight away on upload,
// separately from the "Save settings" button, so a half-edited form can't
// lose the image and an older database without the column doesn't block
// saving the other settings.
const QR_BUCKET = 'payment-qr';

function PaymentQrSection({ url, onChange }: { url: string; onChange: (url: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function saveUrl(next: string) {
    const { error } = await supabase
      .from('shop_settings')
      .update({ payment_qr_url: next, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) {
      // Most likely cause on an un-migrated database.
      if (/payment_qr_url/.test(error.message)) {
        throw new Error('The database is missing the payment QR column. Run migrations/payment_qr.sql in Supabase first.');
      }
      throw new Error(error.message);
    }
  }

  async function upload(f: File | null) {
    setFile(f);
    setMsg(null);
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setMsg({ ok: false, text: 'Please pick an image file (PNG or JPG).' });
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setMsg({ ok: false, text: 'Image is too big (5 MB max).' });
      return;
    }
    setBusy(true);
    try {
      const ext = (f.name.split('.').pop() ?? 'png').toLowerCase();
      // New file name every time so phones/iPads never show a cached old QR.
      const path = `shop-qr-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from(QR_BUCKET)
        .upload(path, f, { cacheControl: '3600', upsert: false, contentType: f.type });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from(QR_BUCKET).getPublicUrl(path);
      await saveUrl(data.publicUrl);
      onChange(data.publicUrl);
      setFile(null);
      setMsg({ ok: true, text: 'QR saved. The cashier screen now shows this QR.' });
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Upload failed' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMsg(null);
    try {
      await saveUrl('');
      onChange('');
      setMsg({ ok: true, text: 'QR removed.' });
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not remove' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mt-6 bg-white rounded-3xl p-6 border border-[var(--ink-200)]"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <h2 className="text-lg font-bold text-[var(--ink-900)] mb-1">QR payment</h2>
      <p className="text-sm text-[var(--ink-500)] mb-5">
        Your shop&apos;s Touch &apos;n Go / DuitNow QR. The cashier shows it to the customer when they
        pay by QR. Upload the QR image exactly as your eWallet app gives it.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 items-start">
        <div className="rounded-2xl border border-[var(--ink-200)] bg-[var(--cream-100)] p-3 flex items-center justify-center min-h-[220px]">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Shop payment QR" className="max-h-[320px] w-auto rounded-xl" />
          ) : (
            <span className="text-sm text-[var(--ink-400)] text-center">No QR uploaded yet</span>
          )}
        </div>
        <div>
          <FileUpload
            label={url ? 'Replace QR image' : 'Upload QR image'}
            hint="PNG or JPG, max 5 MB. Saved as soon as it uploads."
            accept="image/*"
            file={file}
            onChange={upload}
            buttonText={busy ? 'Uploading…' : 'Upload QR image'}
            icon="📱"
          />
          {url && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--ink-200)] bg-white text-[var(--ink-700)] hover:bg-[var(--ink-100)] disabled:opacity-60"
            >
              Remove QR
            </button>
          )}
          {msg && (
            <p className={`mt-3 text-sm ${msg.ok ? 'text-[var(--jade-600)] font-semibold' : 'text-[var(--brand-700)]'}`}>
              {msg.text}
            </p>
          )}
        </div>
      </div>
    </section>
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
