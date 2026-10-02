'use client';

// Daily Expenses (每日支出) — the single place the owner enters all
// non-sales costs for a given business day: staff wages, staff meals,
// daily purchases, other expenses, rent, utilities.
//
// The date at the top drives everything.  Switching the date reloads
// the expenses for that day and lets you enter more or edit existing.
// Rent and utility rows are entered on the day the bill was paid,
// per the owner's preference.
//
// One rule from the client's spec:
//   *** Purchases are NOT attributed to specific dishes. ***
//   You record "Today's Purchase = RM 1,250" and the categories
//   underneath are just for your own paper trail (supplier, meat,
//   flour, etc.) — the system never splits them into 點心 / 包點 / 飯.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listExpensesForDate,
  insertExpense,
  deleteExpense,
} from '@/lib/expenses';
import { getCurrentUser } from '@/lib/roles';
import {
  AdminPageHeader,
  ContentCard,
  Field,
  PrimaryBtn,
  SecondaryBtn,
  ErrorBanner,
  EmptyState,
  inputBase,
} from '@/components/ui';
import type {
  Expense,
  ExpenseKind,
  PayMethod,
} from '@/lib/types';
import {
  EXPENSE_LABELS,
  PAY_METHOD_LABELS,
} from '@/lib/types';
import { supabase } from '@/lib/supabase';

// Which tab is currently active.  Every tab has its own quick-entry form
// but they all write to the same `expenses` table.
type Tab = ExpenseKind;

const TABS: Tab[] = ['wages', 'meal', 'purchase', 'other', 'rent', 'utility'];

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmt(n: number): string {
  return `RM ${(Number(n) || 0).toFixed(2)}`;
}

// Turn any thrown value into a readable string.
// Supabase throws plain `{ message, code, hint, details }` objects that don't
// extend `Error`, so `String(e)` gives "[object Object]".  This function
// walks the object and stitches together whatever readable text it can find.
function extractMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e == null) return fallback;
  if (typeof e === 'string') return e || fallback;
  if (e instanceof Error) return e.message || fallback;
  if (typeof e === 'object') {
    const obj = e as { message?: unknown; hint?: unknown; details?: unknown; code?: unknown };
    const parts: string[] = [];
    if (typeof obj.message === 'string' && obj.message) parts.push(obj.message);
    if (typeof obj.details === 'string' && obj.details) parts.push(obj.details);
    if (typeof obj.hint    === 'string' && obj.hint)    parts.push(`hint: ${obj.hint}`);
    if (typeof obj.code    === 'string' && obj.code)    parts.push(`(${obj.code})`);
    if (parts.length > 0) return parts.join(' — ');
    // Last resort — JSON dump so it's at least inspectable.
    try { return JSON.stringify(e); } catch { return fallback; }
  }
  return String(e);
}

// -------------------------------------------------------------------------
// Main page
// -------------------------------------------------------------------------

export default function ExpensesPage() {
  const [date, setDate] = useState<string>(todayISO());
  const [tab, setTab] = useState<Tab>('purchase');
  const [rows, setRows] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [me, setMe] = useState<{ email: string | null }>({ email: null });

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [list, u] = await Promise.all([
        listExpensesForDate(date),
        getCurrentUser(),
      ]);
      setRows(list);
      setMe({ email: u.email });
    } catch (e: unknown) {
      setErr(extractMessage(e));
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  // Totals for the top summary bar — one number per expense kind.
  const totals = useMemo(() => {
    const out: Record<ExpenseKind, number> = {
      wages: 0, meal: 0, purchase: 0, other: 0, rent: 0, utility: 0,
    };
    for (const r of rows) {
      out[r.kind] = (out[r.kind] || 0) + Number(r.amount);
    }
    return out;
  }, [rows]);

  const grand = useMemo(
    () => (Object.values(totals) as number[]).reduce((s, v) => s + v, 0),
    [totals]
  );

  const rowsThisTab = rows.filter((r) => r.kind === tab);

  async function onDelete(id: number) {
    if (!confirm('Delete this entry? / 確定刪除嗎?')) return;
    try {
      await deleteExpense(id);
      await load();
    } catch (e: unknown) {
      setErr(extractMessage(e));
    }
  }

  async function onSaved() {
    await load();
  }

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1400px] mx-auto px-4 md:px-8 py-8">
      <AdminPageHeader
        title="Daily Expenses"
        titleZh="每日支出"
        sub="Enter today's wages, meals, purchases, and other operating costs / 記錄工資、伙食、採購及其他開支"
        right={
          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-widest text-[var(--ink-500)] font-semibold">
              Date · 日期
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2 rounded-xl border border-[var(--ink-200)] bg-white font-mono text-sm"
            />
          </div>
        }
      />

      {err && <ErrorBanner>{err}</ErrorBanner>}

      {/* Summary strip — one card per expense kind, plus a grand total. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 mb-6">
        {TABS.map((k) => (
          <SummaryTile
            key={k}
            kind={k}
            amount={totals[k]}
            active={tab === k}
            onClick={() => setTab(k)}
          />
        ))}
        <div className="col-span-2 md:col-span-3 lg:col-span-1 rounded-2xl p-4 text-white flex flex-col justify-center"
             style={{ background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))', boxShadow: 'var(--shadow-brand)' }}>
          <p className="text-[10px] uppercase tracking-widest opacity-80">Total · 總額</p>
          <p className="text-2xl font-bold mt-1">{fmt(grand)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left side: entry form */}
        <div className="lg:col-span-2">
          <ContentCard>
            <h2 className="text-lg font-bold text-[var(--ink-900)] mb-4 flex items-center gap-2">
              <span>{EXPENSE_LABELS[tab].emoji}</span>
              Add {EXPENSE_LABELS[tab].label}
              <span className="text-[var(--ink-500)] font-normal">· 添加 {EXPENSE_LABELS[tab].label_zh}</span>
            </h2>
            <ExpenseForm
              kind={tab}
              date={date}
              actorEmail={me.email}
              onSaved={onSaved}
            />
          </ContentCard>
        </div>

        {/* Right side: list of entries for this tab, on this day */}
        <div className="lg:col-span-3">
          <ContentCard>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--ink-900)] flex items-center gap-2">
                <span>{EXPENSE_LABELS[tab].emoji}</span>
                {EXPENSE_LABELS[tab].label} entries
                <span className="text-[var(--ink-500)] font-normal">· {EXPENSE_LABELS[tab].label_zh}</span>
              </h2>
              <span className="text-sm text-[var(--ink-500)]">
                {rowsThisTab.length} entries · {fmt(totals[tab])}
              </span>
            </div>

            {loading ? (
              <p className="text-sm text-[var(--ink-500)]">Loading…</p>
            ) : rowsThisTab.length === 0 ? (
              <EmptyState
                emoji={EXPENSE_LABELS[tab].emoji}
                title={`No ${EXPENSE_LABELS[tab].label.toLowerCase()} entries yet`}
                sub={`Use the form to add ${EXPENSE_LABELS[tab].label_zh}.`}
              />
            ) : (
              <ul className="divide-y divide-[var(--ink-100)]">
                {rowsThisTab.map((r) => (
                  <ExpenseRow key={r.id} row={r} onDelete={() => onDelete(r.id)} />
                ))}
              </ul>
            )}
          </ContentCard>
        </div>
      </div>
    </main>
  );
}

// -------------------------------------------------------------------------
// Summary tile
// -------------------------------------------------------------------------

function SummaryTile({
  kind, amount, active, onClick,
}: {
  kind: ExpenseKind;
  amount: number;
  active: boolean;
  onClick: () => void;
}) {
  const meta = EXPENSE_LABELS[kind];
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl p-4 border text-left transition ${
        active
          ? 'bg-[var(--brand-50)] border-[var(--brand-500)] shadow-md'
          : 'bg-white border-[var(--ink-200)] hover:border-[var(--brand-200)]'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{meta.emoji}</span>
        <p className="text-[10px] uppercase tracking-widest text-[var(--ink-500)] font-semibold">
          {meta.label}
        </p>
      </div>
      <p className="text-lg font-bold text-[var(--ink-900)]">{fmt(amount)}</p>
      <p className="text-[10px] text-[var(--ink-400)] mt-0.5">{meta.label_zh}</p>
    </button>
  );
}

// -------------------------------------------------------------------------
// Row list item
// -------------------------------------------------------------------------

function ExpenseRow({ row, onDelete }: { row: Expense; onDelete: () => void }) {
  const pm = row.payment_method
    ? PAY_METHOD_LABELS[row.payment_method as PayMethod]
    : null;

  return (
    <li className="py-3 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-[var(--ink-900)]">
            {row.kind === 'wages'
              ? row.staff_name || 'Staff'
              : row.description || row.supplier || EXPENSE_LABELS[row.kind].label}
          </p>
          {row.supplier && row.kind === 'purchase' && (
            <span className="text-xs text-[var(--ink-500)]">· {row.supplier}</span>
          )}
        </div>
        {row.kind === 'wages' && (
          <p className="text-xs text-[var(--ink-500)] mt-0.5">
            {row.hours != null && `${row.hours}h · `}
            {row.normal_wage != null && `Base ${fmt(row.normal_wage)}`}
            {row.ot_amount != null && row.ot_amount > 0 && ` · OT ${fmt(row.ot_amount)}`}
            {row.other_amount != null && row.other_amount > 0 && ` · Other ${fmt(row.other_amount)}`}
          </p>
        )}
        {row.note && (
          <p className="text-xs text-[var(--ink-500)] mt-0.5 italic">"{row.note}"</p>
        )}
        {pm && (
          <p className="text-xs text-[var(--ink-400)] mt-0.5">
            {pm.emoji} {pm.label} · {pm.label_zh}
          </p>
        )}
        {row.receipt_url && (
          <a
            href={row.receipt_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[var(--brand-600)] hover:underline mt-0.5 inline-block"
          >
            📎 Receipt · 收據
          </a>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <p className="text-lg font-bold text-[var(--ink-900)]">{fmt(row.amount)}</p>
        <button
          onClick={onDelete}
          className="text-xs text-[var(--brand-600)] hover:text-[var(--brand-800)] font-medium"
        >
          Delete · 刪除
        </button>
      </div>
    </li>
  );
}

// -------------------------------------------------------------------------
// Expense entry form — shape depends on which tab is selected.
// -------------------------------------------------------------------------

function ExpenseForm({
  kind, date, actorEmail, onSaved,
}: {
  kind: ExpenseKind;
  date: string;
  actorEmail: string | null;
  onSaved: () => void | Promise<void>;
}) {
  const [amount, setAmount]           = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [supplier, setSupplier]       = useState<string>('');
  const [payMethod, setPayMethod]     = useState<PayMethod>('cash');
  const [note, setNote]               = useState<string>('');
  // Wages-specific — just a plain text name field now, no staff dropdown.
  const [staffName, setStaffName]     = useState<string>('');
  const [hours, setHours]             = useState<string>('');
  const [normalWage, setNormalWage]   = useState<string>('');
  const [otAmount, setOtAmount]       = useState<string>('');
  const [otherAmount, setOtherAmount] = useState<string>('');
  // Receipt upload
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const [busy, setBusy]               = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  // For wages, keep the amount in sync with the sum of the parts so the
  // owner can see the total wage as they type each component.
  useEffect(() => {
    if (kind !== 'wages') return;
    const total =
      (Number(normalWage) || 0) +
      (Number(otAmount)   || 0) +
      (Number(otherAmount) || 0);
    setAmount(total ? total.toFixed(2) : '');
  }, [kind, normalWage, otAmount, otherAmount]);

  function reset() {
    setAmount('');
    setDescription('');
    setSupplier('');
    setPayMethod('cash');
    setNote('');
    setStaffName('');
    setHours('');
    setNormalWage('');
    setOtAmount('');
    setOtherAmount('');
    setReceiptFile(null);
  }

  async function uploadReceipt(): Promise<string | null> {
    if (!receiptFile) return null;
    const ext = receiptFile.name.split('.').pop() ?? 'jpg';
    const path = `${date}/${kind}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from('expense-receipts')
      .upload(path, receiptFile, { upsert: false, contentType: receiptFile.type });
    if (error) {
      // Supabase storage errors are plain objects — wrap so the UI shows
      // a readable message, not "[object Object]".
      const msg = (error as { message?: string })?.message
        ?? 'Failed to upload receipt (is the "expense-receipts" bucket created?)';
      throw new Error(msg);
    }
    const { data } = supabase.storage.from('expense-receipts').getPublicUrl(path);
    return data.publicUrl;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error('Enter an amount greater than 0');

      // For wages, require a name
      if (kind === 'wages' && !staffName.trim()) throw new Error('Enter a staff name');

      const receiptUrl = await uploadReceipt();

      await insertExpense({
        kind,
        business_date: date,
        amount: amt,
        payment_method: payMethod,
        description: description || null,
        supplier: kind === 'purchase' ? supplier || null : null,
        receipt_url: receiptUrl,
        staff_name: kind === 'wages' ? staffName.trim() : null,
        hours: kind === 'wages' && hours ? Number(hours) : null,
        normal_wage: kind === 'wages' && normalWage ? Number(normalWage) : null,
        ot_amount: kind === 'wages' && otAmount ? Number(otAmount) : null,
        other_amount: kind === 'wages' && otherAmount ? Number(otherAmount) : null,
        note: note || null,
        created_by: actorEmail,
      });
      reset();
      await onSaved();
    } catch (e: unknown) {
      setErr(extractMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {err && <ErrorBanner>{err}</ErrorBanner>}

      {/* ------- Wages: staff name + hours + parts breakdown ------- */}
      {kind === 'wages' && (
        <>
          <Field label="Staff name · 員工姓名">
            <input
              type="text"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              className={inputBase}
              placeholder="e.g. Ah Hock"
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hours · 工時">
              <input
                type="number" step="0.25" min={0}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className={inputBase}
                placeholder="8"
              />
            </Field>
            <Field label="Base wage · 基本工資 (RM)">
              <input
                type="number" step="0.01" min={0}
                value={normalWage}
                onChange={(e) => setNormalWage(e.target.value)}
                className={inputBase}
                placeholder="80.00"
              />
            </Field>
            <Field label="OT · 加班 (RM)">
              <input
                type="number" step="0.01" min={0}
                value={otAmount}
                onChange={(e) => setOtAmount(e.target.value)}
                className={inputBase}
                placeholder="0"
              />
            </Field>
            <Field label="Other · 其他 (RM)">
              <input
                type="number" step="0.01" min={0}
                value={otherAmount}
                onChange={(e) => setOtherAmount(e.target.value)}
                className={inputBase}
                placeholder="0"
              />
            </Field>
          </div>
        </>
      )}

      {/* ------- Purchase: supplier + description ------- */}
      {kind === 'purchase' && (
        <>
          <Field label="Supplier · 供應商">
            <input
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              className={inputBase}
              placeholder="e.g. Market, Uncle Lim, ABC Foods"
            />
          </Field>
          <Field label="Description · 說明" hint="Optional label — meat, seafood, vegetables, oil, packaging, etc.">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputBase}
              placeholder="e.g. Pork + Shrimp"
            />
          </Field>
        </>
      )}

      {/* ------- Other / Rent / Utility / Meal: single description ------- */}
      {(kind === 'other' || kind === 'rent' || kind === 'utility' || kind === 'meal') && (
        <Field label="Description · 說明">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputBase}
            placeholder={
              kind === 'meal'    ? 'e.g. 8 staff meals'
              : kind === 'rent'  ? 'e.g. September rent'
              : kind === 'utility' ? 'e.g. TNB July bill'
              : 'e.g. cleaning, packaging, transport'
            }
          />
        </Field>
      )}

      {/* ------- Amount (auto-calculated for wages) ------- */}
      <Field label="Amount · 金額 (RM)">
        <input
          type="number" step="0.01" min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={inputBase}
          readOnly={kind === 'wages'}
          required
        />
      </Field>

      <Field label="Payment method · 付款方式">
        <select
          value={payMethod}
          onChange={(e) => setPayMethod(e.target.value as PayMethod)}
          className={inputBase}
        >
          {(Object.keys(PAY_METHOD_LABELS) as PayMethod[]).map((m) => (
            <option key={m} value={m}>
              {PAY_METHOD_LABELS[m].emoji} {PAY_METHOD_LABELS[m].label} · {PAY_METHOD_LABELS[m].label_zh}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Note · 備註" hint="Optional">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={inputBase}
        />
      </Field>

      <Field label="Receipt photo · 收據照片" hint="Optional — JPG/PNG/PDF, max 8 MB">
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
          className="block text-sm text-[var(--ink-700)]"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <SecondaryBtn onClick={reset}>Clear · 清除</SecondaryBtn>
        <PrimaryBtn type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save · 保存'}
        </PrimaryBtn>
      </div>
    </form>
  );
}
