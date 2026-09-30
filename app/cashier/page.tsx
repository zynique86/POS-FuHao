'use client';

// Cashier — redesigned. Voids, reprints, split bills, payment flows.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  fetchOpenShift,
  openShift,
  closeShift,
  todayISODate,
  type Shift,
} from '@/lib/shifts';
import type { Order as BaseOrder, OrderItem, Payment, PayMethod } from '@/lib/types';

type Order = BaseOrder & { items: OrderItem[]; payments: Payment[] };

type Screen =
  | { kind: 'closed' }
  | { kind: 'menu'; orderId: number }
  | { kind: 'pay'; orderId: number; amount: number; label?: string }
  | { kind: 'split'; orderId: number }
  | { kind: 'void'; orderId: number; itemId: number }
  | { kind: 'refund'; orderId: number }
  | { kind: 'discount'; orderId: number }
  | { kind: 'openShift' }
  | { kind: 'closeShift' };

export default function CashierPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [paidToday, setPaidToday] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>({ kind: 'closed' });
  const [shift, setShift] = useState<Shift | null>(null);

  async function refreshShift() {
    setShift(await fetchOpenShift(todayISODate()));
  }

  async function loadAll() {
    const [openRes, paidRes] = await Promise.all([
      supabase
        .from('orders')
        .select('*')
        .is('paid_at', null)
        .order('created_at', { ascending: true }),
      supabase
        .from('orders')
        .select('*')
        .not('paid_at', 'is', null)
        .gte('paid_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
        .order('paid_at', { ascending: false })
        .limit(20),
    ]);

    const all = [...(openRes.data ?? []), ...(paidRes.data ?? [])] as BaseOrder[];
    const ids = all.map((o) => o.id);

    const [itemRes, payRes] = await Promise.all([
      ids.length
        ? supabase.from('order_items').select('*').in('order_id', ids)
        : Promise.resolve({ data: [] as OrderItem[] }),
      ids.length
        ? supabase.from('payments').select('*').in('order_id', ids)
        : Promise.resolve({ data: [] as Payment[] }),
    ]);

    const combine = (rows: BaseOrder[]): Order[] =>
      rows.map((o) => ({
        ...o,
        items: (itemRes.data ?? []).filter((i) => i.order_id === o.id) as OrderItem[],
        payments: (payRes.data ?? []).filter((p) => p.order_id === o.id) as Payment[],
      }));

    setOrders(combine((openRes.data ?? []) as BaseOrder[]));
    setPaidToday(combine((paidRes.data ?? []) as BaseOrder[]));
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    refreshShift();
    const channel = supabase
      .channel('cashier')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_opens' }, () => refreshShift())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Cash sales this shift → used for expected drawer close.
  const cashSalesToday = useMemo(() => {
    return paidToday.reduce((s, o) => {
      const cashPay = o.payments.find((p) => p.method === 'cash');
      return s + (cashPay ? Number(cashPay.amount) : 0);
    }, 0);
  }, [paidToday]);

  const activeOrder =
    screen.kind === 'closed'
      ? null
      : orders.find((o) => o.id === (screen as { orderId: number }).orderId) ??
        paidToday.find((o) => o.id === (screen as { orderId: number }).orderId) ??
        null;

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1600px] mx-auto px-4 md:px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-500)]">
            Cashier · 收銀
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-[var(--ink-900)] mt-1">
            Take Payment
          </h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <StatChip label="Unpaid" value={orders.length} accent />
          <StatChip label="Paid today" value={paidToday.length} />
        </div>
      </header>

      <ShiftBanner
        shift={shift}
        cashSalesToday={cashSalesToday}
        onOpen={() => setScreen({ kind: 'openShift' })}
        onClose={() => setScreen({ kind: 'closeShift' })}
      />

      {loading ? (
        <p className="text-[var(--ink-500)]">Loading…</p>
      ) : (
        <>
          {orders.length === 0 && paidToday.length === 0 && (
            <EmptyState />
          )}

          {orders.length > 0 && (
            <section className="mb-10">
              <SectionHead label="Unpaid orders" count={orders.length} />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {orders.map((o) => (
                  <UnpaidCard
                    key={o.id}
                    order={o}
                    onOpen={() => setScreen({ kind: 'menu', orderId: o.id })}
                  />
                ))}
              </div>
            </section>
          )}

          {paidToday.length > 0 && (
            <section>
              <SectionHead label="Paid today" count={paidToday.length} />
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {paidToday.map((o) => (
                  <PaidChip
                    key={o.id}
                    order={o}
                    onOpen={() => setScreen({ kind: 'menu', orderId: o.id })}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {activeOrder && screen.kind === 'menu' && (
        <OrderMenuModal
          order={activeOrder}
          onClose={() => setScreen({ kind: 'closed' })}
          onPayFull={(amount) =>
            setScreen({ kind: 'pay', orderId: activeOrder.id, amount })
          }
          onSplit={() => setScreen({ kind: 'split', orderId: activeOrder.id })}
          onVoidItem={(itemId) =>
            setScreen({ kind: 'void', orderId: activeOrder.id, itemId })
          }
          onReprint={async () => {
            await supabase.from('print_jobs').insert({
              order_id: activeOrder.id,
              kind: 'receipt',
              station: 'cashier',
              payload: { reprint: true },
            });
            setScreen({ kind: 'closed' });
          }}
          onRefund={() => setScreen({ kind: 'refund', orderId: activeOrder.id })}
          onDiscount={() => setScreen({ kind: 'discount', orderId: activeOrder.id })}
        />
      )}

      {activeOrder && screen.kind === 'discount' && (
        <DiscountModal
          order={activeOrder}
          onCancel={() => setScreen({ kind: 'menu', orderId: activeOrder.id })}
          onDone={() => setScreen({ kind: 'menu', orderId: activeOrder.id })}
        />
      )}

      {activeOrder && screen.kind === 'pay' && (
        <PayModal
          order={activeOrder}
          amount={screen.amount}
          label={screen.label}
          onCancel={() => setScreen({ kind: 'menu', orderId: activeOrder.id })}
          onDone={() => setScreen({ kind: 'closed' })}
        />
      )}

      {activeOrder && screen.kind === 'split' && (
        <SplitModal
          order={activeOrder}
          onCancel={() => setScreen({ kind: 'menu', orderId: activeOrder.id })}
          onPayPart={(amount, label) =>
            setScreen({ kind: 'pay', orderId: activeOrder.id, amount, label })
          }
        />
      )}

      {activeOrder && screen.kind === 'void' && (
        <VoidModal
          order={activeOrder}
          itemId={screen.itemId}
          onCancel={() => setScreen({ kind: 'menu', orderId: activeOrder.id })}
          onDone={() => setScreen({ kind: 'menu', orderId: activeOrder.id })}
        />
      )}

      {activeOrder && screen.kind === 'refund' && (
        <RefundModal
          order={activeOrder}
          onCancel={() => setScreen({ kind: 'menu', orderId: activeOrder.id })}
          onDone={() => setScreen({ kind: 'closed' })}
        />
      )}

      {screen.kind === 'openShift' && (
        <OpenShiftModal
          onCancel={() => setScreen({ kind: 'closed' })}
          onDone={async () => {
            await refreshShift();
            setScreen({ kind: 'closed' });
          }}
        />
      )}

      {screen.kind === 'closeShift' && shift && (
        <CloseShiftModal
          shift={shift}
          cashSalesToday={cashSalesToday}
          onCancel={() => setScreen({ kind: 'closed' })}
          onDone={async () => {
            await refreshShift();
            setScreen({ kind: 'closed' });
          }}
        />
      )}
    </main>
  );
}

// ─── shift banner ─────────────────────────────────────────────────────────

function ShiftBanner({
  shift,
  cashSalesToday,
  onOpen,
  onClose,
}: {
  shift: Shift | null;
  cashSalesToday: number;
  onOpen: () => void;
  onClose: () => void;
}) {
  if (!shift) {
    return (
      <div
        className="mb-6 rounded-2xl p-4 md:p-5 flex flex-wrap items-center justify-between gap-3"
        style={{
          background: 'linear-gradient(135deg, var(--cream-100), var(--cream-200))',
          border: '1px solid var(--cream-300)',
        }}
      >
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-[var(--ink-500)] font-semibold">
            No shift open
          </p>
          <p className="text-sm text-[var(--ink-700)] mt-0.5">
            Enter your opening cash float to start tracking the drawer.
          </p>
        </div>
        <button
          onClick={onOpen}
          className="text-white font-bold px-5 py-3 rounded-xl"
          style={{
            background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
            boxShadow: 'var(--shadow-brand)',
          }}
        >
          Open shift
        </button>
      </div>
    );
  }

  const expected = Number(shift.opening_float) + cashSalesToday;
  const opened = new Date(shift.opened_at).toLocaleTimeString('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="mb-6 rounded-2xl p-4 md:p-5 grid grid-cols-2 md:grid-cols-4 gap-4"
      style={{
        background: 'linear-gradient(135deg, var(--brand-50), var(--cream-100))',
        border: '1px solid var(--brand-100)',
      }}
    >
      <div>
        <p className="text-[10px] uppercase tracking-widest text-[var(--ink-500)] font-semibold">
          Shift opened
        </p>
        <p className="font-bold text-[var(--ink-900)] mt-0.5">{opened}</p>
        {shift.opened_by && (
          <p className="text-xs text-[var(--ink-500)]">by {shift.opened_by}</p>
        )}
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-widest text-[var(--ink-500)] font-semibold">
          Opening float
        </p>
        <p className="font-mono font-bold text-[var(--ink-900)] mt-0.5">
          RM {Number(shift.opening_float).toFixed(2)}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-widest text-[var(--ink-500)] font-semibold">
          Cash sales
        </p>
        <p className="font-mono font-bold text-[var(--brand-700)] mt-0.5">
          RM {cashSalesToday.toFixed(2)}
        </p>
      </div>
      <div className="flex items-center justify-end gap-3">
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-widest text-[var(--ink-500)] font-semibold">
            Expected in drawer
          </p>
          <p className="font-mono font-bold text-[var(--ink-900)] mt-0.5">
            RM {expected.toFixed(2)}
          </p>
        </div>
        <button
          onClick={onClose}
          className="bg-[var(--ink-800)] hover:bg-[var(--ink-900)] text-white font-bold px-4 py-2.5 rounded-xl text-sm"
        >
          Close shift
        </button>
      </div>
    </div>
  );
}

// ─── open shift modal ─────────────────────────────────────────────────────

function OpenShiftModal({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [float, setFloat] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const n = Number(float);
    if (!Number.isFinite(n) || n < 0) return setErr('Enter a valid float amount');
    setBusy(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const by = userRes?.user?.email ?? 'staff';
      await openShift(n, by);
      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to open shift';
      setErr(msg);
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={onCancel} title="Open shift" sub="Enter the opening cash float">
      <F label="Opening cash float (RM)">
        <input
          type="number"
          step="0.05"
          value={float}
          onChange={(e) => setFloat(e.target.value)}
          placeholder="200.00"
          className="w-full px-4 py-4 border border-[var(--ink-200)] rounded-2xl font-mono text-3xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
          autoFocus
        />
      </F>
      {err && (
        <div className="bg-[var(--brand-50)] border border-[var(--brand-100)] text-[var(--brand-700)] p-2 rounded-xl mb-4 text-sm">
          {err}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <SecondaryBtn onClick={onCancel} disabled={busy}>Cancel</SecondaryBtn>
        <PrimaryBtn onClick={submit} disabled={busy}>
          {busy ? 'Opening…' : 'Open shift'}
        </PrimaryBtn>
      </div>
    </ModalShell>
  );
}

// ─── close shift modal ────────────────────────────────────────────────────

function CloseShiftModal({
  shift,
  cashSalesToday,
  onCancel,
  onDone,
}: {
  shift: Shift;
  cashSalesToday: number;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [count, setCount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const expected = Number(shift.opening_float) + cashSalesToday;
  const counted = Number(count) || 0;
  const variance = count ? counted - expected : 0;

  async function submit() {
    if (!count) return setErr('Enter the drawer count');
    setBusy(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const by = userRes?.user?.email ?? 'staff';
      await closeShift(shift.id, counted, cashSalesToday, by, notes.trim() || undefined);
      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to close shift';
      setErr(msg);
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={onCancel} title="Close shift" sub="Count the drawer, compare to expected">
      <div className="bg-[var(--cream-100)] rounded-2xl p-4 mb-4 space-y-1 text-sm">
        <div className="flex justify-between text-[var(--ink-600)]">
          <span>Opening float</span>
          <span className="font-mono">RM {Number(shift.opening_float).toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-[var(--ink-600)]">
          <span>Cash sales</span>
          <span className="font-mono">RM {cashSalesToday.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-bold text-[var(--ink-900)] border-t border-[var(--cream-300)] pt-1 mt-1">
          <span>Expected in drawer</span>
          <span className="font-mono">RM {expected.toFixed(2)}</span>
        </div>
      </div>

      <F label="Counted in drawer (RM)">
        <input
          type="number"
          step="0.05"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          className="w-full px-4 py-4 border border-[var(--ink-200)] rounded-2xl font-mono text-3xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
          autoFocus
        />
      </F>

      {count && (
        <div
          className={`rounded-2xl p-3 mb-4 text-center ${
            Math.abs(variance) < 0.05
              ? 'bg-[var(--jade-100)] text-[var(--jade-600)]'
              : 'bg-[var(--brand-50)] text-[var(--brand-700)]'
          }`}
        >
          <p className="text-xs uppercase tracking-widest font-semibold">Variance</p>
          <p className="text-2xl font-bold font-mono">
            {variance > 0 ? '+' : ''}RM {variance.toFixed(2)}
          </p>
        </div>
      )}

      <F label="Notes (optional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. RM10 paid out for coriander"
          className="w-full px-3 py-2 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
        />
      </F>

      {err && (
        <div className="bg-[var(--brand-50)] border border-[var(--brand-100)] text-[var(--brand-700)] p-2 rounded-xl mb-4 text-sm">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <SecondaryBtn onClick={onCancel} disabled={busy}>Cancel</SecondaryBtn>
        <PrimaryBtn onClick={submit} disabled={busy}>
          {busy ? 'Closing…' : 'Close shift'}
        </PrimaryBtn>
      </div>
    </ModalShell>
  );
}

// ─── refund modal ─────────────────────────────────────────────────────────

function RefundModal({
  order,
  onCancel,
  onDone,
}: {
  order: Order;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    if (!reason.trim()) return setErr('Reason is required');
    setBusy(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const by = userRes?.user?.email ?? 'staff';
      const amount = Number(order.total);

      // Insert a negative payment as the refund record
      const { error: payErr } = await supabase.from('payments').insert({
        order_id: order.id,
        method: order.payment_method ?? 'cash',
        amount: -amount,
        received: -amount,
        change_given: 0,
        status: 'refunded',
      });
      if (payErr) throw payErr;

      // Mark order refunded
      await supabase
        .from('orders')
        .update({
          status: 'refunded',
          refunded_at: new Date().toISOString(),
          refund_reason: reason.trim(),
          refunded_by: by,
        })
        .eq('id', order.id);

      // Enqueue a refund slip print — goes to the counter printer.
      await supabase.from('print_jobs').insert({
        order_id: order.id,
        kind: 'refund',
        station: 'cashier',
        payload: { reason: reason.trim(), by, amount },
      });

      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message
                : (typeof e === 'object' && e !== null && 'message' in e)
                  ? String((e as { message: unknown }).message)
                  : 'Refund failed';
      setErr(msg);
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={onCancel} title="Refund order" sub={`Table ${order.table_number} · Order #${order.id}`}>
      <div className="bg-[var(--brand-50)] border border-[var(--brand-100)] rounded-2xl p-4 mb-4 text-center">
        <p className="text-xs uppercase tracking-widest text-[var(--ink-500)] font-semibold">
          Refunding
        </p>
        <p className="text-4xl font-bold font-mono text-[var(--brand-700)] mt-1">
          RM {Number(order.total).toFixed(2)}
        </p>
        <p className="text-xs text-[var(--ink-500)] mt-1">
          Original method: {order.payment_method ?? 'cash'}
        </p>
      </div>

      <F label="Reason">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. customer allergic reaction, wrong order"
          className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
          autoFocus
        />
      </F>

      {err && (
        <div className="bg-[var(--brand-50)] border border-[var(--brand-100)] text-[var(--brand-700)] p-2 rounded-xl mb-4 text-sm">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <SecondaryBtn onClick={onCancel} disabled={busy}>Cancel</SecondaryBtn>
        <PrimaryBtn onClick={confirm} disabled={busy}>
          {busy ? 'Refunding…' : 'Confirm refund'}
        </PrimaryBtn>
      </div>
    </ModalShell>
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

// ─── small pieces ─────────────────────────────────────────────────────────

function StatChip({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={`px-3 py-2 rounded-2xl ${accent ? 'text-white' : 'bg-white text-[var(--ink-800)] border border-[var(--ink-200)]'}`}
      style={accent ? { background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))', boxShadow: 'var(--shadow-brand)' } : undefined}
    >
      <p className={`text-[10px] uppercase tracking-widest ${accent ? 'text-white/70' : 'text-[var(--ink-500)]'}`}>{label}</p>
      <p className="text-lg font-bold font-mono leading-tight">{value}</p>
    </div>
  );
}

function SectionHead({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <h2 className="text-xs uppercase tracking-widest text-[var(--ink-500)] font-semibold">
        {label}
      </h2>
      <span className="text-xs text-[var(--ink-400)]">{count}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20">
      <div className="text-6xl mb-3 opacity-40">🫖</div>
      <p className="text-lg text-[var(--ink-700)] font-semibold">All caught up</p>
      <p className="text-sm text-[var(--ink-500)] mt-1">
        New unpaid orders will appear here automatically.
      </p>
    </div>
  );
}

// ─── unpaid card ──────────────────────────────────────────────────────────

function UnpaidCard({ order, onOpen }: { order: Order; onOpen: () => void }) {
  const active = order.items.filter((i) => !i.voided_at);
  const paidSoFar = order.payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, Number(order.total) - paidSoFar);
  const partial = paidSoFar > 0 && remaining > 0;
  return (
    <button
      onClick={onOpen}
      className="card-hover text-left bg-white rounded-2xl p-5 border border-[var(--ink-200)] w-full"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[var(--ink-500)]">Table</p>
          <p className="text-2xl font-bold text-[var(--ink-900)]">{order.table_number}</p>
        </div>
        <span className="text-[10px] text-[var(--ink-400)] font-mono">#{order.id}</span>
      </div>
      <p className="text-xs text-[var(--ink-500)] mb-1">
        {active.length} item{active.length === 1 ? '' : 's'}
      </p>
      {order.taken_by_name && (
        <p className="text-[11px] text-[var(--ink-500)] mb-3">
          Taken by <b className="text-[var(--ink-800)]">{order.taken_by_name}</b>
        </p>
      )}
      <div className="flex items-baseline gap-3 border-t border-[var(--ink-100)] pt-3">
        <span className="text-sm text-[var(--ink-500)] flex-1">
          {partial ? 'Remaining' : 'Total'}
        </span>
        <span className="text-xl font-mono font-bold text-[var(--brand-700)] whitespace-nowrap">
          RM {(partial ? remaining : Number(order.total)).toFixed(2)}
        </span>
      </div>
      {partial && (
        <p className="mt-2 text-[10px] text-[var(--gold-600)] font-semibold uppercase tracking-wider">
          Split in progress · RM {paidSoFar.toFixed(2)} paid
        </p>
      )}
    </button>
  );
}

function PaidChip({ order, onOpen }: { order: Order; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="card-hover text-left bg-white rounded-xl px-3 py-2.5 border border-[var(--ink-200)]"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-bold text-[var(--ink-800)] text-sm">T{order.table_number}</span>
        <span className="text-[10px] text-[var(--ink-400)] font-mono">#{order.id}</span>
      </div>
      <div className="font-mono text-xs text-[var(--brand-700)] font-bold mt-1">
        RM {Number(order.total).toFixed(2)}
      </div>
    </button>
  );
}

// ─── order menu modal ─────────────────────────────────────────────────────

function OrderMenuModal({
  order,
  onClose,
  onPayFull,
  onSplit,
  onVoidItem,
  onReprint,
  onRefund,
  onDiscount,
}: {
  order: Order;
  onClose: () => void;
  onPayFull: (amount: number) => void;
  onSplit: () => void;
  onVoidItem: (itemId: number) => void;
  onReprint: () => void;
  onRefund: () => void;
  onDiscount: () => void;
}) {
  const isPaid = !!order.paid_at;
  const paidSoFar = order.payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, Number(order.total) - paidSoFar);

  return (
    <ModalShell onClose={onClose} title={`Table ${order.table_number}`} sub={`Order #${order.id}`}>
      <ul className="space-y-1 mb-4 text-sm max-h-64 overflow-y-auto -mx-1 px-1">
        {order.items.map((i) => {
          const voided = !!i.voided_at;
          return (
            <li
              key={i.id}
              className={`flex items-center justify-between gap-2 py-1.5 ${
                voided ? 'text-[var(--ink-400)] line-through' : 'text-[var(--ink-800)]'
              }`}
            >
              <span className="flex-1 min-w-0 truncate">
                <span className="font-mono text-[var(--ink-400)]">{i.qty}×</span>{' '}
                {i.name_snapshot}
                {i.name_zh_snapshot && (
                  <span className="text-[var(--ink-400)]"> · {i.name_zh_snapshot}</span>
                )}
              </span>
              <span className="font-mono w-20 text-right">
                RM {(Number(i.price_at_time) * i.qty).toFixed(2)}
              </span>
              {!isPaid && !voided && (
                <button
                  onClick={() => onVoidItem(i.id)}
                  className="text-[10px] px-2 py-1 rounded-lg bg-[var(--brand-50)] text-[var(--brand-700)] hover:bg-[var(--brand-100)] font-bold uppercase tracking-wider shrink-0"
                >
                  Void
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="text-sm space-y-1 border-t border-[var(--ink-100)] pt-4 mb-4">
        <BRow label="Subtotal" value={Number(order.subtotal ?? order.total)} />
        {Number(order.service_charge) > 0 && (
          <BRow label="Service" value={Number(order.service_charge)} />
        )}
        {Number(order.tax) > 0 && <BRow label="SST" value={Number(order.tax)} />}
        {Number(order.rounding) !== 0 && <BRow label="Rounding" value={Number(order.rounding)} />}
        {Number(order.discount) > 0 && (
          <div className="flex justify-between text-[var(--jade-600)]">
            <span>Discount{order.discount_reason ? ` · ${order.discount_reason}` : ''}</span>
            <span className="font-mono">− RM {Number(order.discount).toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between text-lg font-bold text-[var(--ink-900)] pt-2 border-t border-[var(--ink-100)]">
          <span>Total</span>
          <span className="font-mono text-[var(--brand-700)]">
            RM {Number(order.total).toFixed(2)}
          </span>
        </div>
        {paidSoFar > 0 && !isPaid && (
          <>
            <BRow label="Paid so far" value={paidSoFar} />
            <div className="flex justify-between text-[var(--gold-600)] font-bold">
              <span>Remaining</span>
              <span className="font-mono">RM {remaining.toFixed(2)}</span>
            </div>
          </>
        )}
      </div>

      {!isPaid ? (
        <div className="space-y-2">
          <PrimaryBtn onClick={() => onPayFull(remaining)}>
            Pay RM {remaining.toFixed(2)}
          </PrimaryBtn>
          <div className="grid grid-cols-3 gap-2">
            <SecondaryBtn onClick={onDiscount}>
              {Number(order.discount) > 0 ? 'Edit discount' : 'Discount'}
            </SecondaryBtn>
            <SecondaryBtn onClick={onSplit}>Split bill</SecondaryBtn>
            <SecondaryBtn onClick={onClose}>Close</SecondaryBtn>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <PrimaryBtn onClick={onReprint}>🖨️ Reprint receipt</PrimaryBtn>
          {order.status !== 'refunded' && (
            <button
              onClick={onRefund}
              className="w-full font-bold py-3 rounded-2xl transition text-[var(--brand-700)] bg-[var(--brand-50)] hover:bg-[var(--brand-100)] border border-[var(--brand-200)]"
            >
              ↩ Refund order
            </button>
          )}
          {order.status === 'refunded' && (
            <p className="text-center text-sm text-[var(--brand-700)] bg-[var(--brand-50)] py-2 rounded-xl font-semibold">
              This order has been refunded.
            </p>
          )}
          <SecondaryBtn onClick={onClose}>Close</SecondaryBtn>
        </div>
      )}
    </ModalShell>
  );
}

// ─── pay modal ────────────────────────────────────────────────────────────

function PayModal({
  order,
  amount,
  label,
  onCancel,
  onDone,
}: {
  order: Order;
  amount: number;
  label?: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [received, setReceived] = useState('');
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!method) return;
    setBusy(true);
    const receivedNum = method === 'cash' ? Number(received) : amount;
    const change = method === 'cash' ? Math.max(0, receivedNum - amount) : 0;

    const { error: payErr } = await supabase.from('payments').insert({
      order_id: order.id,
      method,
      amount,
      received: receivedNum,
      change_given: change,
      status: 'succeeded',
    });
    if (payErr) {
      alert('Payment failed: ' + payErr.message);
      setBusy(false);
      return;
    }

    const { data: allPays } = await supabase.from('payments').select('amount').eq('order_id', order.id);
    const paidNow = (allPays ?? []).reduce((s, p) => s + Number(p.amount), 0);

    if (paidNow + 0.001 >= Number(order.total)) {
      const { error: updErr } = await supabase
        .from('orders')
        .update({
          paid_at: new Date().toISOString(),
          payment_method: method,
          status: 'paid',
        })
        .eq('id', order.id);
      if (updErr) {
        alert('Failed to close order: ' + updErr.message);
        setBusy(false);
        return;
      }
      await supabase.from('print_jobs').insert({
        order_id: order.id,
        kind: 'receipt',
        station: 'cashier',
        payload: { reprint: false },
      });
    }

    setBusy(false);
    onDone();
  }

  return (
    <ModalShell onClose={onCancel} title={`Table ${order.table_number}`} sub={label ? label : `Order #${order.id}`}>
      <div className="text-center mb-6 py-5 rounded-2xl"
           style={{ background: 'linear-gradient(135deg, var(--brand-50), var(--cream-100))' }}>
        <p className="text-xs uppercase tracking-widest text-[var(--ink-500)]">Amount due</p>
        <p className="text-5xl font-bold font-mono text-[var(--brand-700)] mt-1">
          RM {amount.toFixed(2)}
        </p>
      </div>

      {!method && (
        <div className="grid grid-cols-3 gap-2">
          <MethodBtn onClick={() => setMethod('cash')} emoji="💵" label="Cash" />
          <MethodBtn onClick={() => setMethod('duitnow_qr')} emoji="📱" label="DuitNow" />
          <MethodBtn onClick={() => setMethod('card')} emoji="💳" label="Card" />
        </div>
      )}

      {method === 'cash' && (
        <div>
          <label className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-2 font-semibold">
            Cash received
          </label>
          <input
            type="number"
            step="0.05"
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            placeholder={amount.toFixed(2)}
            className="w-full px-4 py-4 text-3xl font-mono border-2 border-[var(--ink-200)] rounded-2xl mb-3 focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
            autoFocus
          />
          {received && Number(received) >= amount && (
            <div className="text-center mb-3 p-4 rounded-2xl bg-[var(--jade-100)]">
              <p className="text-xs uppercase tracking-widest text-[var(--jade-600)] font-semibold">
                Change to return
              </p>
              <p className="text-3xl font-bold font-mono text-[var(--jade-600)] mt-1">
                RM {(Number(received) - amount).toFixed(2)}
              </p>
            </div>
          )}
          <ConfirmBtn onClick={confirm} disabled={busy || !received || Number(received) < amount} busy={busy}>
            Confirm Cash Payment
          </ConfirmBtn>
        </div>
      )}

      {method === 'duitnow_qr' && (
        <div className="text-center">
          <p className="text-sm text-[var(--ink-500)] mb-3">Show this QR to the customer</p>
          <div className="inline-block p-5 rounded-2xl mb-3"
               style={{ background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))' }}>
            <div className="w-48 h-48 bg-white rounded-xl p-3">
              <div className="w-full h-full bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2032%2032%22><rect%20fill=%22white%22%20width=%2232%22%20height=%2232%22/><g%20fill=%22black%22><rect%20x=%220%22%20y=%220%22%20width=%227%22%20height=%227%22/><rect%20x=%222%22%20y=%222%22%20width=%223%22%20height=%223%22%20fill=%22white%22/><rect%20x=%2225%22%20y=%220%22%20width=%227%22%20height=%227%22/><rect%20x=%2227%22%20y=%222%22%20width=%223%22%20height=%223%22%20fill=%22white%22/><rect%20x=%220%22%20y=%2225%22%20width=%227%22%20height=%227%22/><rect%20x=%222%22%20y=%2227%22%20width=%223%22%20height=%223%22%20fill=%22white%22/><rect%20x=%229%22%20y=%222%22%20width=%222%22%20height=%222%22/><rect%20x=%2213%22%20y=%222%22%20width=%222%22%20height=%222%22/><rect%20x=%2217%22%20y=%222%22%20width=%222%22%20height=%222%22/><rect%20x=%2221%22%20y=%222%22%20width=%222%22%20height=%222%22/><rect%20x=%229%22%20y=%229%22%20width=%2214%22%20height=%2214%22/><rect%20x=%2211%22%20y=%2211%22%20width=%2210%22%20height=%2210%22%20fill=%22white%22/><rect%20x=%2213%22%20y=%2213%22%20width=%206%22%20height=%206%22/></g></svg>')] bg-contain bg-no-repeat bg-center" />
            </div>
          </div>
          <p className="text-xs text-[var(--ink-400)] mb-4">
            Placeholder QR — connect Fiuu/iPay88 later for real DuitNow QR
          </p>
          <ConfirmBtn onClick={confirm} disabled={busy} busy={busy}>
            Customer Paid — Confirm
          </ConfirmBtn>
        </div>
      )}

      {method === 'card' && (
        <div className="text-center">
          <div className="bg-[var(--cream-100)] rounded-2xl p-6 mb-4">
            <p className="text-xs uppercase tracking-widest text-[var(--ink-500)] font-semibold">
              On your card terminal
            </p>
            <p className="text-sm text-[var(--ink-700)] font-semibold mt-2">Charge</p>
            <p className="text-3xl font-mono font-bold text-[var(--brand-700)] mt-1">
              RM {amount.toFixed(2)}
            </p>
          </div>
          <p className="text-xs text-[var(--ink-400)] mb-4">
            Once the card is approved on the EDC, press below
          </p>
          <ConfirmBtn onClick={confirm} disabled={busy} busy={busy}>
            Card Approved — Confirm
          </ConfirmBtn>
        </div>
      )}

      {method && (
        <button
          onClick={() => setMethod(null)}
          className="w-full mt-3 text-sm text-[var(--ink-500)] hover:text-[var(--brand-600)] font-semibold"
        >
          ← Change payment method
        </button>
      )}
    </ModalShell>
  );
}

// ─── split ────────────────────────────────────────────────────────────────

function SplitModal({
  order,
  onCancel,
  onPayPart,
}: {
  order: Order;
  onCancel: () => void;
  onPayPart: (amount: number, label: string) => void;
}) {
  const [n, setN] = useState(2);
  const paidSoFar = order.payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, Number(order.total) - paidSoFar);
  const perHead = useMemo(() => Math.round((remaining / n) * 100) / 100, [remaining, n]);

  return (
    <ModalShell onClose={onCancel} title="Split bill" sub={`Table ${order.table_number}`}>
      <div className="text-center mb-6 py-4 rounded-2xl"
           style={{ background: 'linear-gradient(135deg, var(--brand-50), var(--cream-100))' }}>
        <p className="text-xs uppercase tracking-widest text-[var(--ink-500)]">Remaining to split</p>
        <p className="text-4xl font-bold font-mono text-[var(--brand-700)] mt-1">
          RM {remaining.toFixed(2)}
        </p>
      </div>

      <label className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-2 font-semibold">
        Split into
      </label>
      <div className="flex items-center gap-3 mb-5 bg-[var(--cream-100)] rounded-2xl p-2">
        <button
          onClick={() => setN(Math.max(2, n - 1))}
          className="w-12 h-12 rounded-xl bg-white border border-[var(--ink-200)] text-xl font-bold hover:border-[var(--brand-400)]"
        >
          −
        </button>
        <div className="flex-1 text-center">
          <span className="text-3xl font-bold font-mono">{n}</span>
          <span className="text-sm text-[var(--ink-500)] ml-2">ways</span>
        </div>
        <button
          onClick={() => setN(Math.min(20, n + 1))}
          className="w-12 h-12 rounded-xl bg-white border border-[var(--ink-200)] text-xl font-bold hover:border-[var(--brand-400)]"
        >
          +
        </button>
      </div>

      <div className="bg-[var(--gold-400)]/15 border border-[var(--gold-400)]/40 rounded-2xl p-4 text-center mb-5">
        <p className="text-xs uppercase tracking-widest text-[var(--ink-500)]">Each person pays</p>
        <p className="text-3xl font-bold font-mono text-[var(--brand-700)] mt-1">
          RM {perHead.toFixed(2)}
        </p>
      </div>

      <p className="text-xs text-[var(--ink-500)] mb-4">
        Take payment one at a time. Order closes automatically when the full amount is paid.
      </p>

      <PrimaryBtn
        onClick={() =>
          onPayPart(perHead, `Split ${n} ways · RM ${perHead.toFixed(2)} each`)
        }
      >
        Take one share · RM {perHead.toFixed(2)}
      </PrimaryBtn>
      <SecondaryBtn onClick={onCancel}>Back</SecondaryBtn>
    </ModalShell>
  );
}

// ─── void ─────────────────────────────────────────────────────────────────

function VoidModal({
  order,
  itemId,
  onCancel,
  onDone,
}: {
  order: Order;
  itemId: number;
  onCancel: () => void;
  onDone: () => void;
}) {
  const item = order.items.find((i) => i.id === itemId);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!item) return null;

  async function confirm() {
    setBusy(true);
    const { data: userRes } = await supabase.auth.getUser();
    const by = userRes?.user?.email ?? 'staff';

    const { error: voidErr } = await supabase
      .from('order_items')
      .update({
        voided_at: new Date().toISOString(),
        void_reason: reason || 'no reason given',
        voided_by: by,
      })
      .eq('id', itemId);
    if (voidErr) {
      alert('Void failed: ' + voidErr.message);
      setBusy(false);
      return;
    }

    const { data: remaining } = await supabase
      .from('order_items')
      .select('qty, price_at_time, voided_at')
      .eq('order_id', order.id);
    const activeSubtotal = (remaining ?? [])
      .filter((r) => !r.voided_at)
      .reduce((s, r) => s + Number(r.price_at_time) * r.qty, 0);

    const { computeBreakdown } = await import('@/lib/pricing');
    const { fetchSettings } = await import('@/lib/settings');
    const s = await fetchSettings();
    const b = computeBreakdown(activeSubtotal, s);

    await supabase.from('orders').update({
      subtotal: b.subtotal,
      service_charge: b.service_charge,
      tax: b.tax,
      rounding: b.rounding,
      total: b.total,
    }).eq('id', order.id);

    // Void notice — route to the station that was cooking the item.
    const menuItemId = item?.menu_item_id ?? -1;
    const { data: menuRow } = await supabase
      .from('menu_items')
      .select('station')
      .eq('id', menuItemId)
      .maybeSingle();
    const voidStation = (menuRow?.station as 'kitchen' | 'bar') ?? 'kitchen';

    await supabase.from('print_jobs').insert({
      order_id: order.id,
      kind: 'void',
      station: voidStation,
      payload: { item_id: itemId, reason: reason || 'no reason given' },
    });

    setBusy(false);
    onDone();
  }

  return (
    <ModalShell onClose={onCancel} title="Void item" sub={`Table ${order.table_number}`}>
      <div className="bg-[var(--brand-50)] border border-[var(--brand-100)] rounded-2xl p-4 mb-4">
        <p className="text-[var(--ink-800)]">
          <span className="font-mono text-[var(--ink-500)]">{item.qty}×</span>{' '}
          <span className="font-semibold">{item.name_snapshot}</span>
          {item.name_zh_snapshot && <span className="text-[var(--ink-500)]"> · {item.name_zh_snapshot}</span>}
        </p>
      </div>

      <label className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-2 font-semibold">
        Reason (kitchen will see)
      </label>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. wrong order, customer changed mind"
        className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl mb-5 focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
        autoFocus
      />

      <div className="grid grid-cols-2 gap-2">
        <SecondaryBtn onClick={onCancel} disabled={busy}>Cancel</SecondaryBtn>
        <PrimaryBtn onClick={confirm} disabled={busy}>
          {busy ? 'Voiding…' : 'Confirm void'}
        </PrimaryBtn>
      </div>
    </ModalShell>
  );
}

// ─── discount modal ───────────────────────────────────────────────────────

function DiscountModal({
  order,
  onCancel,
  onDone,
}: {
  order: Order;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<'pct' | 'amount'>('amount');
  const [value, setValue] = useState<string>(
    Number(order.discount) > 0 ? String(order.discount) : ''
  );
  const [reason, setReason] = useState<string>(order.discount_reason ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const subtotal = Number(order.subtotal ?? order.total) || 0;
  const svc = Number(order.service_charge) || 0;
  const tax = Number(order.tax) || 0;
  const grossBeforeDiscount = subtotal + svc + tax;

  const discount = useMemo(() => {
    const n = Number(value) || 0;
    if (n <= 0) return 0;
    if (mode === 'pct') return Math.min(grossBeforeDiscount, (grossBeforeDiscount * n) / 100);
    return Math.min(grossBeforeDiscount, n);
  }, [value, mode, grossBeforeDiscount]);

  const newGross = Math.max(0, grossBeforeDiscount - discount);
  const rounded = Math.round(newGross * 20) / 20; // 5-sen rounding, always on for MYR shops
  const rounding = Math.round((rounded - newGross) * 100) / 100;
  const newTotal = rounded;

  async function apply(clear: boolean = false) {
    setBusy(true);
    setErr(null);
    try {
      const d = clear ? 0 : discount;
      const finalGross = subtotal + svc + tax - d;
      const finalTotal = Math.round(finalGross * 20) / 20;
      const finalRounding = Math.round((finalTotal - finalGross) * 100) / 100;

      const { error } = await supabase
        .from('orders')
        .update({
          discount: Math.round(d * 100) / 100,
          discount_reason: clear ? null : (reason.trim() || null),
          rounding: finalRounding,
          total: finalTotal,
        })
        .eq('id', order.id);
      if (error) throw error;

      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message
                : (typeof e === 'object' && e !== null && 'message' in e)
                  ? String((e as { message: unknown }).message)
                  : 'Failed to apply';
      setErr(msg);
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={onCancel} title="Discount" sub={`Table ${order.table_number}`}>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setMode('amount')}
          className={`py-3 rounded-xl font-bold text-sm transition ${
            mode === 'amount'
              ? 'text-white'
              : 'bg-[var(--cream-100)] text-[var(--ink-700)] hover:bg-[var(--cream-200)]'
          }`}
          style={mode === 'amount' ? { background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))' } : undefined}
        >
          RM amount
        </button>
        <button
          onClick={() => setMode('pct')}
          className={`py-3 rounded-xl font-bold text-sm transition ${
            mode === 'pct'
              ? 'text-white'
              : 'bg-[var(--cream-100)] text-[var(--ink-700)] hover:bg-[var(--cream-200)]'
          }`}
          style={mode === 'pct' ? { background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))' } : undefined}
        >
          Percentage %
        </button>
      </div>

      <label className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-1.5 font-semibold">
        {mode === 'pct' ? 'Percentage off (%)' : 'Amount off (RM)'}
      </label>
      <input
        type="number"
        inputMode="decimal"
        step={mode === 'pct' ? '1' : '0.05'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={mode === 'pct' ? '10' : '5.00'}
        className="w-full px-4 py-4 text-3xl font-mono border-2 border-[var(--ink-200)] rounded-2xl mb-4 focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
        autoFocus
      />

      <label className="block text-xs uppercase tracking-widest text-[var(--ink-500)] mb-1.5 font-semibold">
        Reason (optional)
      </label>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. regular customer, senior citizen"
        className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl mb-4 focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)]"
      />

      {/* Preview */}
      <div className="bg-[var(--cream-100)] rounded-2xl p-4 mb-4 space-y-1 text-sm">
        <div className="flex justify-between text-[var(--ink-600)]">
          <span>Subtotal + service + SST</span>
          <span className="font-mono">RM {grossBeforeDiscount.toFixed(2)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-[var(--jade-600)] font-semibold">
            <span>Discount</span>
            <span className="font-mono">− RM {discount.toFixed(2)}</span>
          </div>
        )}
        {rounding !== 0 && (
          <div className="flex justify-between text-[var(--ink-600)]">
            <span>Rounding</span>
            <span className="font-mono">RM {rounding.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between text-lg font-bold text-[var(--ink-900)] pt-1 border-t border-[var(--cream-300)]">
          <span>New total</span>
          <span className="font-mono text-[var(--brand-700)]">RM {newTotal.toFixed(2)}</span>
        </div>
      </div>

      {err && (
        <div className="bg-[var(--brand-50)] border border-[var(--brand-100)] text-[var(--brand-700)] p-2 rounded-xl mb-3 text-sm">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {Number(order.discount) > 0 ? (
          <SecondaryBtn onClick={() => apply(true)} disabled={busy}>Clear discount</SecondaryBtn>
        ) : (
          <SecondaryBtn onClick={onCancel} disabled={busy}>Cancel</SecondaryBtn>
        )}
        <PrimaryBtn onClick={() => apply(false)} disabled={busy || discount === 0}>
          {busy ? 'Applying…' : `Apply · RM ${discount.toFixed(2)}`}
        </PrimaryBtn>
      </div>
    </ModalShell>
  );
}

// ─── shared ────────────────────────────────────────────────────────────────

function ModalShell({
  title,
  sub,
  onClose,
  children,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-[var(--ink-900)]/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-md w-full p-6 max-h-[95vh] overflow-y-auto animate-rise"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="flex justify-between items-baseline mb-5">
          <div>
            <h2 className="text-2xl font-bold text-[var(--ink-900)]">{title}</h2>
            {sub && <p className="text-xs text-[var(--ink-400)] font-mono mt-0.5">{sub}</p>}
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--ink-100)] hover:bg-[var(--ink-200)] text-[var(--ink-500)] text-base"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-[var(--ink-500)]">
      <span>{label}</span>
      <span className="font-mono">RM {value.toFixed(2)}</span>
    </div>
  );
}

function MethodBtn({ onClick, emoji, label }: { onClick: () => void; emoji: string; label: string }) {
  return (
    <button
      onClick={onClick}
      className="bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-[var(--ink-800)] font-semibold py-5 rounded-2xl transition"
    >
      <div className="text-2xl mb-1">{emoji}</div>
      <div className="text-xs">{label}</div>
    </button>
  );
}

function PrimaryBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-white font-bold py-3.5 rounded-2xl transition disabled:opacity-60"
      style={{
        background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
        boxShadow: 'var(--shadow-brand)',
      }}
    >
      {children}
    </button>
  );
}

function SecondaryBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full bg-[var(--cream-100)] hover:bg-[var(--cream-200)] text-[var(--ink-800)] font-bold py-3 rounded-2xl transition disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function ConfirmBtn({
  children,
  onClick,
  disabled,
  busy,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-white font-bold py-3.5 rounded-2xl text-base transition disabled:opacity-60"
      style={{
        background: 'linear-gradient(135deg, var(--jade-500), var(--jade-600))',
        boxShadow: '0 10px 24px -8px rgb(5 150 105 / 0.35)',
      }}
    >
      {busy ? 'Recording…' : children}
    </button>
  );
}
