'use client';

// Cashier — takes payments, splits bills, voids items, reprints receipts.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Order as BaseOrder, OrderItem, Payment, PayMethod } from '@/lib/types';

type Order = BaseOrder & { items: OrderItem[]; payments: Payment[] };

type Screen =
  | { kind: 'closed' }
  | { kind: 'menu'; orderId: number }
  | { kind: 'pay'; orderId: number; amount: number; label?: string }
  | { kind: 'split'; orderId: number }
  | { kind: 'void'; orderId: number; itemId: number };

export default function CashierPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [paidToday, setPaidToday] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>({ kind: 'closed' });

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
    const channel = supabase
      .channel('cashier')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => loadAll())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) return <Shell>Loading…</Shell>;

  const activeOrder =
    screen.kind === 'closed'
      ? null
      : orders.find((o) => o.id === (screen as { orderId: number }).orderId) ??
        paidToday.find((o) => o.id === (screen as { orderId: number }).orderId) ??
        null;

  return (
    <main className="min-h-screen bg-stone-50 p-4 md:p-6">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-stone-800">💰 Cashier</h1>
        <span className="text-stone-500 text-sm">
          {orders.length} unpaid · {paidToday.length} paid today
        </span>
      </header>

      {orders.length === 0 && (
        <div className="text-center text-stone-400 mt-20 mb-10">
          <p className="text-xl">No unpaid orders</p>
        </div>
      )}

      {orders.length > 0 && (
        <>
          <h2 className="text-sm uppercase tracking-wider text-stone-500 mb-2">Unpaid</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            {orders.map((o) => (
              <UnpaidCard key={o.id} order={o} onOpen={() => setScreen({ kind: 'menu', orderId: o.id })} />
            ))}
          </div>
        </>
      )}

      {paidToday.length > 0 && (
        <>
          <h2 className="text-sm uppercase tracking-wider text-stone-500 mb-2">Paid today</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {paidToday.map((o) => (
              <PaidChip key={o.id} order={o} onOpen={() => setScreen({ kind: 'menu', orderId: o.id })} />
            ))}
          </div>
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
              payload: { reprint: true },
            });
            setScreen({ kind: 'closed' });
          }}
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
    </main>
  );
}

// ─── list cards ───────────────────────────────────────────────────────────

function UnpaidCard({ order, onOpen }: { order: Order; onOpen: () => void }) {
  const paidSoFar = order.payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, Number(order.total) - paidSoFar);
  const partial = paidSoFar > 0 && remaining > 0;
  const active = order.items.filter((i) => !i.voided_at);
  return (
    <button
      onClick={onOpen}
      className="text-left bg-white rounded-lg p-4 shadow-sm border border-stone-200 hover:border-red-400 transition"
    >
      <div className="flex justify-between items-baseline mb-3">
        <h3 className="text-xl font-bold text-stone-800">Table {order.table_number}</h3>
        <span className="text-xs text-stone-400 font-mono">#{order.id}</span>
      </div>
      <p className="text-sm text-stone-500 mb-3">
        {active.length} item{active.length === 1 ? '' : 's'}
      </p>
      <div className="flex justify-between font-bold border-t border-stone-100 pt-2">
        <span>{partial ? 'Remaining' : 'Total'}</span>
        <span className="font-mono text-red-700">RM {(partial ? remaining : Number(order.total)).toFixed(2)}</span>
      </div>
      {partial && (
        <p className="text-xs text-amber-600 mt-1">
          RM {paidSoFar.toFixed(2)} paid — split in progress
        </p>
      )}
    </button>
  );
}

function PaidChip({ order, onOpen }: { order: Order; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="text-left bg-white rounded-lg px-3 py-2 border border-stone-200 hover:border-red-400 transition"
    >
      <div className="flex justify-between items-baseline">
        <span className="font-bold text-stone-700 text-sm">T{order.table_number}</span>
        <span className="text-[10px] text-stone-400 font-mono">#{order.id}</span>
      </div>
      <div className="font-mono text-xs text-red-700 mt-0.5">RM {Number(order.total).toFixed(2)}</div>
    </button>
  );
}

// ─── order menu ───────────────────────────────────────────────────────────

function OrderMenuModal({
  order,
  onClose,
  onPayFull,
  onSplit,
  onVoidItem,
  onReprint,
}: {
  order: Order;
  onClose: () => void;
  onPayFull: (amount: number) => void;
  onSplit: () => void;
  onVoidItem: (itemId: number) => void;
  onReprint: () => void;
}) {
  const isPaid = !!order.paid_at;
  const paidSoFar = order.payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, Number(order.total) - paidSoFar);

  return (
    <ModalShell onClose={onClose} title={`Table ${order.table_number}`} sub={`Order #${order.id}`}>
      {/* line items */}
      <ul className="space-y-1 mb-4 text-sm">
        {order.items.map((i) => {
          const voided = !!i.voided_at;
          return (
            <li
              key={i.id}
              className={`flex items-center justify-between gap-2 py-1 ${
                voided ? 'text-stone-400 line-through' : 'text-stone-700'
              }`}
            >
              <span className="flex-1 min-w-0 truncate">
                <span className="font-mono text-stone-500">{i.qty}x</span>{' '}
                {i.name_snapshot}
                {i.name_zh_snapshot && (
                  <span className="text-stone-500"> · {i.name_zh_snapshot}</span>
                )}
              </span>
              <span className="font-mono w-20 text-right">
                RM {(Number(i.price_at_time) * i.qty).toFixed(2)}
              </span>
              {!isPaid && !voided && (
                <button
                  onClick={() => onVoidItem(i.id)}
                  className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 font-bold shrink-0"
                >
                  Void
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* breakdown */}
      <div className="text-sm space-y-1 border-t border-stone-100 pt-3 mb-4">
        <BRow label="Subtotal" value={Number(order.subtotal ?? order.total)} />
        {Number(order.service_charge) > 0 && (
          <BRow label="Service" value={Number(order.service_charge)} />
        )}
        {Number(order.tax) > 0 && <BRow label="SST" value={Number(order.tax)} />}
        {Number(order.rounding) !== 0 && (
          <BRow label="Rounding" value={Number(order.rounding)} />
        )}
        <div className="flex justify-between font-bold text-lg text-stone-800 pt-1 border-t border-stone-100">
          <span>Total</span>
          <span className="font-mono text-red-700">RM {Number(order.total).toFixed(2)}</span>
        </div>
        {paidSoFar > 0 && !isPaid && (
          <>
            <BRow label="Paid so far" value={paidSoFar} />
            <div className="flex justify-between font-bold text-amber-700">
              <span>Remaining</span>
              <span className="font-mono">RM {remaining.toFixed(2)}</span>
            </div>
          </>
        )}
      </div>

      {/* actions */}
      {!isPaid ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onPayFull(remaining)}
            className="col-span-2 bg-red-700 hover:bg-red-800 text-white font-bold py-3 rounded-lg"
          >
            Pay RM {remaining.toFixed(2)}
          </button>
          <button
            onClick={onSplit}
            className="bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold py-3 rounded-lg"
          >
            Split bill
          </button>
          <button
            onClick={onClose}
            className="bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold py-3 rounded-lg"
          >
            Close
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onReprint}
            className="col-span-2 bg-red-700 hover:bg-red-800 text-white font-bold py-3 rounded-lg"
          >
            🖨️ Reprint receipt
          </button>
          <button
            onClick={onClose}
            className="col-span-2 bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold py-3 rounded-lg"
          >
            Close
          </button>
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

    // Fetch fresh payments to see if the order is now fully paid.
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
      // Enqueue receipt print for the fully-paid order.
      await supabase.from('print_jobs').insert({
        order_id: order.id,
        kind: 'receipt',
        payload: { reprint: false },
      });
    }

    setBusy(false);
    onDone();
  }

  return (
    <ModalShell
      onClose={onCancel}
      title={`Table ${order.table_number}`}
      sub={label ? label : `Order #${order.id}`}
    >
      <div className="text-center mb-6 border-y border-stone-100 py-4">
        <p className="text-stone-500 text-sm">Amount due</p>
        <p className="text-4xl font-bold font-mono text-red-700">RM {amount.toFixed(2)}</p>
      </div>

      {!method && (
        <div className="grid grid-cols-3 gap-2">
          <MethodBtn onClick={() => setMethod('cash')} emoji="💵" label="Cash" />
          <MethodBtn onClick={() => setMethod('duitnow_qr')} emoji="📱" label="DuitNow QR" />
          <MethodBtn onClick={() => setMethod('card')} emoji="💳" label="Card" />
        </div>
      )}

      {method === 'cash' && (
        <div>
          <label className="block text-sm text-stone-600 mb-1">Cash received (RM)</label>
          <input
            type="number"
            step="0.05"
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            placeholder={amount.toFixed(2)}
            className="w-full px-3 py-3 text-2xl font-mono border-2 border-stone-300 rounded-lg mb-3"
            autoFocus
          />
          {received && Number(received) >= amount && (
            <div className="text-center mb-3 p-3 bg-green-50 rounded">
              <p className="text-sm text-stone-600">Change to return</p>
              <p className="text-2xl font-bold font-mono text-green-700">
                RM {(Number(received) - amount).toFixed(2)}
              </p>
            </div>
          )}
          <button
            onClick={confirm}
            disabled={busy || !received || Number(received) < amount}
            className="w-full bg-green-700 hover:bg-green-800 disabled:bg-stone-300 text-white font-bold py-3 rounded-lg"
          >
            {busy ? 'Recording…' : 'Confirm Cash Payment'}
          </button>
        </div>
      )}

      {method === 'duitnow_qr' && (
        <div className="text-center">
          <p className="text-sm text-stone-600 mb-2">Show this QR to the customer</p>
          <div className="bg-white border-4 border-red-700 p-6 rounded-lg inline-block mb-3">
            <div className="w-48 h-48 bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2032%2032%22><rect%20fill=%22white%22%20width=%2232%22%20height=%2232%22/><g%20fill=%22black%22><rect%20x=%220%22%20y=%220%22%20width=%227%22%20height=%227%22/><rect%20x=%222%22%20y=%222%22%20width=%223%22%20height=%223%22%20fill=%22white%22/><rect%20x=%2225%22%20y=%220%22%20width=%227%22%20height=%227%22/><rect%20x=%2227%22%20y=%222%22%20width=%223%22%20height=%223%22%20fill=%22white%22/><rect%20x=%220%22%20y=%2225%22%20width=%227%22%20height=%227%22/><rect%20x=%222%22%20y=%2227%22%20width=%223%22%20height=%223%22%20fill=%22white%22/><rect%20x=%229%22%20y=%222%22%20width=%222%22%20height=%222%22/><rect%20x=%2213%22%20y=%222%22%20width=%222%22%20height=%222%22/><rect%20x=%2217%22%20y=%222%22%20width=%222%22%20height=%222%22/><rect%20x=%2221%22%20y=%222%22%20width=%222%22%20height=%222%22/><rect%20x=%229%22%20y=%229%22%20width=%2214%22%20height=%2214%22/><rect%20x=%2211%22%20y=%2211%22%20width=%2210%22%20height=%2210%22%20fill=%22white%22/><rect%20x=%2213%22%20y=%2213%22%20width=%206%22%20height=%206%22/></g></svg>')] bg-contain bg-no-repeat bg-center"></div>
          </div>
          <p className="text-xs text-stone-400 mb-4">
            Placeholder QR — connect Fiuu/iPay88 later for real DuitNow QR
          </p>
          <button
            onClick={confirm}
            disabled={busy}
            className="w-full bg-green-700 hover:bg-green-800 disabled:bg-stone-300 text-white font-bold py-3 rounded-lg"
          >
            {busy ? 'Recording…' : 'Customer Paid — Confirm'}
          </button>
        </div>
      )}

      {method === 'card' && (
        <div className="text-center">
          <div className="bg-stone-100 p-6 rounded-lg mb-4">
            <p className="text-sm text-stone-600 mb-2">On your card terminal:</p>
            <p className="text-lg font-bold">Charge</p>
            <p className="text-3xl font-mono text-red-700">RM {amount.toFixed(2)}</p>
          </div>
          <p className="text-xs text-stone-400 mb-4">Once the card is approved on the EDC, press below</p>
          <button
            onClick={confirm}
            disabled={busy}
            className="w-full bg-green-700 hover:bg-green-800 disabled:bg-stone-300 text-white font-bold py-3 rounded-lg"
          >
            {busy ? 'Recording…' : 'Card Approved — Confirm'}
          </button>
        </div>
      )}

      {method && (
        <button
          onClick={() => setMethod(null)}
          className="w-full mt-2 text-stone-500 hover:text-stone-700 text-sm"
        >
          ← Change payment method
        </button>
      )}
    </ModalShell>
  );
}

// ─── split modal ──────────────────────────────────────────────────────────

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
      <div className="text-center mb-4">
        <p className="text-stone-500 text-sm">Remaining to split</p>
        <p className="text-3xl font-bold font-mono text-red-700">RM {remaining.toFixed(2)}</p>
      </div>

      <label className="block text-sm text-stone-600 mb-1">Split into</label>
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setN(Math.max(2, n - 1))}
          className="w-10 h-10 rounded bg-stone-100 hover:bg-stone-200 text-xl font-bold"
        >
          −
        </button>
        <div className="flex-1 text-center text-2xl font-bold font-mono">{n} ways</div>
        <button
          onClick={() => setN(Math.min(20, n + 1))}
          className="w-10 h-10 rounded bg-stone-100 hover:bg-stone-200 text-xl font-bold"
        >
          +
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded p-3 text-center mb-4">
        <p className="text-sm text-stone-600">Each person pays</p>
        <p className="text-2xl font-bold font-mono text-red-700">RM {perHead.toFixed(2)}</p>
      </div>

      <p className="text-xs text-stone-500 mb-3">
        Take payment one at a time. Order closes automatically when the full amount is paid.
      </p>

      <button
        onClick={() => onPayPart(perHead, `Split ${n} ways — RM ${perHead.toFixed(2)} each`)}
        className="w-full bg-red-700 hover:bg-red-800 text-white font-bold py-3 rounded-lg mb-2"
      >
        Take one share (RM {perHead.toFixed(2)})
      </button>
      <button
        onClick={onCancel}
        className="w-full bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold py-2 rounded-lg"
      >
        Back
      </button>
    </ModalShell>
  );
}

// ─── void modal ───────────────────────────────────────────────────────────

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

    // Recompute order totals from remaining (non-voided) items.
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

    // Kitchen void notice.
    await supabase.from('print_jobs').insert({
      order_id: order.id,
      kind: 'void',
      payload: { item_id: itemId, reason: reason || 'no reason given' },
    });

    setBusy(false);
    onDone();
  }

  return (
    <ModalShell onClose={onCancel} title="Void item" sub={`Table ${order.table_number}`}>
      <p className="text-stone-700 mb-3">
        <span className="font-mono text-stone-500">{item.qty}x</span> {item.name_snapshot}
        {item.name_zh_snapshot && <span className="text-stone-500"> · {item.name_zh_snapshot}</span>}
      </p>

      <label className="block text-sm text-stone-600 mb-1">Reason (kitchen will see)</label>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. wrong order, customer changed mind"
        className="w-full px-3 py-3 border border-stone-300 rounded mb-4"
        autoFocus
      />

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold py-3 rounded-lg"
        >
          Cancel
        </button>
        <button
          onClick={confirm}
          disabled={busy}
          className="bg-red-700 hover:bg-red-800 disabled:bg-stone-300 text-white font-bold py-3 rounded-lg"
        >
          {busy ? 'Voiding…' : 'Confirm void'}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── shared building blocks ───────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-stone-50 p-6">
      <p>{children}</p>
    </main>
  );
}

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
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg max-w-md w-full p-6 max-h-[95vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-baseline mb-4">
          <div>
            <h2 className="text-2xl font-bold text-stone-800">{title}</h2>
            {sub && <p className="text-xs text-stone-400 font-mono">{sub}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 text-xl"
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
    <div className="flex justify-between text-stone-600">
      <span>{label}</span>
      <span className="font-mono">RM {value.toFixed(2)}</span>
    </div>
  );
}

function MethodBtn({ onClick, emoji, label }: { onClick: () => void; emoji: string; label: string }) {
  return (
    <button
      onClick={onClick}
      className="bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold py-4 rounded-lg"
    >
      {emoji}
      <br />
      <span className="text-sm">{label}</span>
    </button>
  );
}
