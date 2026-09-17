'use client';

// Staff CRUD — three tiers: cashier / supervisor / owner.
// Monthly-salaried staff can also record their base salary here so
// the Monthly Report includes it in "expenses".

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  AdminPageHeader,
  PrimaryBtn,
  SecondaryBtn,
  ErrorBanner,
  EmptyState,
  Field,
  inputBase,
} from '@/components/ui';
import { listStaff, type Staff, type StaffRole } from '@/lib/staff';
import { ROLE_LABELS } from '@/lib/types';
import { logAudit } from '@/lib/expenses';
import { getCurrentUser } from '@/lib/roles';

type Draft = {
  id?: number;
  name: string;
  pin: string;
  role: StaffRole;
  monthly_salary: string;
  active: boolean;
};

const EMPTY: Draft = { name: '', pin: '', role: 'cashier', monthly_salary: '', active: true };

export default function AdminStaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setStaff(await listStaff());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) return setErr('Name is required');
    if (!/^\d{4,6}$/.test(draft.pin.trim())) return setErr('PIN must be 4–6 digits');
    setBusy(true);
    setErr(null);
    const payload = {
      name: draft.name.trim(),
      pin: draft.pin.trim(),
      role: draft.role,
      monthly_salary: draft.monthly_salary ? Number(draft.monthly_salary) : null,
      active: draft.active,
    };
    const me = await getCurrentUser();
    if (draft.id) {
      const prev = staff.find((s) => s.id === draft.id);
      const { error } = await supabase.from('staff').update(payload).eq('id', draft.id);
      if (error) { setBusy(false); return setErr(error.message); }
      if (prev && prev.role !== draft.role) {
        await logAudit({
          actor_email: me.email,
          actor_role: me.role,
          action: 'staff_role_change',
          target_type: 'staff',
          target_id: draft.id,
          reason: `${prev.role} → ${draft.role}`,
          details: { name: prev.name },
        });
      }
    } else {
      const { error } = await supabase.from('staff').insert(payload);
      if (error) { setBusy(false); return setErr(error.message); }
    }
    setBusy(false);
    setDraft(null);
    load();
  }

  async function toggle(s: Staff) {
    await supabase.from('staff').update({ active: !s.active }).eq('id', s.id);
    load();
  }
  async function del(s: Staff) {
    if (!confirm(`Delete ${s.name}? / 確定刪除嗎?`)) return;
    const me = await getCurrentUser();
    await supabase.from('staff').delete().eq('id', s.id);
    await logAudit({
      actor_email: me.email,
      actor_role: me.role,
      action: 'staff_delete',
      target_type: 'staff',
      target_id: s.id,
      details: { name: s.name, role: s.role },
    });
    load();
  }

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1200px] mx-auto px-4 md:px-6 py-6">
      <AdminPageHeader
        title="Staff"
        titleZh="員工"
        sub="Cashier · Supervisor · Owner tiers control what each staff can do / 三級權限"
        right={
          <button
            onClick={() => { setDraft({ ...EMPTY }); setErr(null); }}
            className="text-white font-bold px-5 py-3 rounded-2xl"
            style={{
              background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
              boxShadow: 'var(--shadow-brand)',
            }}
          >
            + Add staff · 添加員工
          </button>
        }
      />

      {loading ? (
        <p className="text-[var(--ink-500)]">Loading…</p>
      ) : staff.length === 0 ? (
        <EmptyState
          emoji="👤"
          title="No staff yet"
          sub="Add your first owner. Their PIN then gates sensitive actions."
        />
      ) : (
        <section className="bg-white rounded-3xl border border-[var(--ink-200)] overflow-hidden"
                 style={{ boxShadow: 'var(--shadow-sm)' }}>
          <ul className="divide-y divide-[var(--ink-100)]">
            {staff.map((s) => {
              const roleMeta = ROLE_LABELS[s.role] ?? ROLE_LABELS.cashier;
              return (
                <li key={s.id} className={`flex flex-wrap items-center gap-3 px-5 py-4 ${!s.active ? 'opacity-60 bg-[var(--ink-100)]/40' : ''}`}>
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                    style={{
                      background: s.role === 'owner'
                        ? 'linear-gradient(135deg, var(--brand-700), var(--brand-900))'
                        : s.role === 'supervisor'
                        ? 'linear-gradient(135deg, var(--gold-500), var(--gold-600))'
                        : 'linear-gradient(135deg, var(--ink-500), var(--ink-700))',
                    }}
                  >
                    {s.name.trim()[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-bold text-[var(--ink-900)]">{s.name}</div>
                    <div className="text-xs text-[var(--ink-500)] uppercase tracking-widest">
                      {roleMeta.emoji} {roleMeta.label} · {roleMeta.label_zh} · PIN {s.pin.replace(/./g, '•')}
                    </div>
                    {s.monthly_salary != null && s.monthly_salary > 0 && (
                      <div className="text-xs text-[var(--ink-500)] mt-0.5">
                        Monthly salary · 月薪 RM {Number(s.monthly_salary).toFixed(2)}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => toggle(s)}
                    className={`text-[10px] px-3 py-1.5 rounded-lg font-bold uppercase tracking-widest ${
                      s.active
                        ? 'bg-[var(--jade-100)] text-[var(--jade-600)]'
                        : 'bg-[var(--ink-200)] text-[var(--ink-500)]'
                    }`}
                  >
                    {s.active ? 'Active' : 'Disabled'}
                  </button>
                  <button
                    onClick={() => {
                      setDraft({
                        id: s.id,
                        name: s.name,
                        pin: s.pin,
                        role: s.role,
                        monthly_salary: s.monthly_salary != null ? String(s.monthly_salary) : '',
                        active: s.active,
                      });
                      setErr(null);
                    }}
                    className="text-xs px-3 py-2 rounded-lg bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-[var(--ink-800)] font-bold"
                  >
                    Edit · 編輯
                  </button>
                  <button
                    onClick={() => del(s)}
                    className="text-xs px-3 py-2 rounded-lg bg-[var(--brand-50)] hover:bg-[var(--brand-100)] text-[var(--brand-700)] font-bold"
                  >
                    Delete · 刪除
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {draft && (
        <div
          className="fixed inset-0 bg-[var(--ink-900)]/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => !busy && setDraft(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full p-6 animate-rise"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: 'var(--shadow-lg)' }}
          >
            <h2 className="text-xl font-bold mb-5">
              {draft.id ? 'Edit staff · 編輯員工' : 'Add staff · 添加員工'}
            </h2>

            <Field label="Name · 姓名">
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={inputBase}
              />
            </Field>

            <Field label="PIN · 密碼 (4–6 digits)">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d*"
                value={draft.pin}
                onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                className={`${inputBase} font-mono text-2xl tracking-widest`}
              />
            </Field>

            <Field label="Role · 權限">
              <select
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value as StaffRole })}
                className={inputBase}
              >
                <option value="cashier">💳 Cashier · 收銀員 — take orders &amp; payments only</option>
                <option value="supervisor">🎖️ Supervisor · 主管 — cashier + void, refund, discount</option>
                <option value="owner">👑 Owner · 老闆 — full access</option>
              </select>
            </Field>

            <Field label="Monthly salary · 月薪 (RM, optional)" hint="Only for staff paid a fixed monthly wage. Leave blank for daily-paid staff.">
              <input
                type="number"
                step="0.01"
                min={0}
                value={draft.monthly_salary}
                onChange={(e) => setDraft({ ...draft, monthly_salary: e.target.value })}
                className={inputBase}
                placeholder="e.g. 2500"
              />
            </Field>

            <label className="flex items-center gap-2 mb-5 text-sm text-[var(--ink-800)] cursor-pointer">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                className="w-4 h-4 accent-[var(--brand-600)]"
              />
              Active · 在職
            </label>

            {err && <ErrorBanner>{err}</ErrorBanner>}

            <div className="grid grid-cols-2 gap-2">
              <SecondaryBtn onClick={() => setDraft(null)} disabled={busy}>Cancel · 取消</SecondaryBtn>
              <PrimaryBtn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save · 保存'}</PrimaryBtn>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
