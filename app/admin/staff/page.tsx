'use client';

// Staff CRUD — add names + PINs + roles.
// The very first staff row you add unlocks PIN gating everywhere else.

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { listStaff, type Staff, type StaffRole } from '@/lib/staff';

type Draft = {
  id?: number;
  name: string;
  pin: string;
  role: StaffRole;
  active: boolean;
};

const EMPTY: Draft = { name: '', pin: '', role: 'cashier', active: true };

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
      active: draft.active,
    };
    const { error } = draft.id
      ? await supabase.from('staff').update(payload).eq('id', draft.id)
      : await supabase.from('staff').insert(payload);
    setBusy(false);
    if (error) return setErr(error.message);
    setDraft(null);
    load();
  }

  async function toggle(s: Staff) {
    await supabase.from('staff').update({ active: !s.active }).eq('id', s.id);
    load();
  }
  async function del(s: Staff) {
    if (!confirm(`Delete ${s.name}?`)) return;
    await supabase.from('staff').delete().eq('id', s.id);
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
            Staff · 員工
          </h1>
          <p className="text-sm text-[var(--ink-500)] mt-1">
            Add cashiers and managers. Managers/admins can access this dashboard.
          </p>
        </div>
        <button
          onClick={() => { setDraft({ ...EMPTY }); setErr(null); }}
          className="text-white font-bold px-5 py-3 rounded-2xl"
          style={{
            background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
            boxShadow: 'var(--shadow-brand)',
          }}
        >
          + Add staff
        </button>
      </header>

      {loading ? (
        <p className="text-[var(--ink-500)]">Loading…</p>
      ) : staff.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-3 opacity-40">👤</div>
          <p className="text-lg text-[var(--ink-700)] font-semibold">No staff yet</p>
          <p className="text-sm text-[var(--ink-500)] mt-1">
            Add your first manager. Their PIN then gates the dashboard.
          </p>
        </div>
      ) : (
        <section className="bg-white rounded-3xl border border-[var(--ink-200)] overflow-hidden"
                 style={{ boxShadow: 'var(--shadow-sm)' }}>
          <ul className="divide-y divide-[var(--ink-100)]">
            {staff.map((s) => (
              <li key={s.id} className={`flex flex-wrap items-center gap-3 px-5 py-4 ${!s.active ? 'opacity-60 bg-[var(--ink-100)]/40' : ''}`}>
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                  style={{
                    background: s.role === 'admin'
                      ? 'linear-gradient(135deg, var(--brand-700), var(--brand-900))'
                      : s.role === 'manager'
                      ? 'linear-gradient(135deg, var(--gold-500), var(--gold-600))'
                      : 'linear-gradient(135deg, var(--ink-500), var(--ink-700))',
                  }}
                >
                  {s.name.trim()[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-[200px]">
                  <div className="font-bold text-[var(--ink-900)]">{s.name}</div>
                  <div className="text-xs text-[var(--ink-500)] uppercase tracking-widest">
                    {s.role} · PIN {s.pin.replace(/./g, '•')}
                  </div>
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
                  onClick={() => { setDraft({ id: s.id, name: s.name, pin: s.pin, role: s.role, active: s.active }); setErr(null); }}
                  className="text-xs px-3 py-2 rounded-lg bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-[var(--ink-800)] font-bold"
                >
                  Edit
                </button>
                <button
                  onClick={() => del(s)}
                  className="text-xs px-3 py-2 rounded-lg bg-[var(--brand-50)] hover:bg-[var(--brand-100)] text-[var(--brand-700)] font-bold"
                >
                  Delete
                </button>
              </li>
            ))}
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
            <h2 className="text-xl font-bold mb-5">{draft.id ? 'Edit staff' : 'Add staff'}</h2>

            <F label="Name">
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
              />
            </F>

            <F label="PIN (4–6 digits)">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d*"
                value={draft.pin}
                onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl font-mono text-2xl tracking-widest focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
              />
            </F>

            <F label="Role">
              <select
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value as StaffRole })}
                className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
              >
                <option value="cashier">Cashier — can take payments</option>
                <option value="manager">Manager — cashier + admin access</option>
                <option value="admin">Admin — full access</option>
              </select>
            </F>

            <label className="flex items-center gap-2 mb-5 text-sm text-[var(--ink-800)] cursor-pointer">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                className="w-4 h-4 accent-[var(--brand-600)]"
              />
              Active
            </label>

            {err && (
              <div className="bg-[var(--brand-50)] border border-[var(--brand-100)] text-[var(--brand-700)] p-2 rounded-xl mb-4 text-sm">
                {err}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setDraft(null)}
                disabled={busy}
                className="bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-[var(--ink-800)] font-bold py-3 rounded-2xl"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="text-white font-bold py-3 rounded-2xl disabled:opacity-60"
                style={{
                  background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
                  boxShadow: 'var(--shadow-brand)',
                }}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
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
