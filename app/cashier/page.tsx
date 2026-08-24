'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Order as BaseOrder, OrderItem, PayMethod } from '@/lib/types';

type Order = BaseOrder & { items: OrderItem[] };

export default function CashierPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeOrderId, setActiveOrderId] = useState<number | null>(null);
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [received, setReceived] = useState<string>('');
  const [processing, setProcessing] = useState(false);

  async function loadOrders() {
    const { data: orderRows } = await supabase
      .from('orders')
      .select('*')
      .is('paid_at', null)
      .order('created_at', { ascending: true });

    if (!orderRows) return;

    const orderIds = orderRows.map((o) => o.id);
    const { data: itemRows } =
      orderIds.length > 0
        ? await supabase.from('order_items').select('*').in('order_id', orderIds)
        : { data: [] };

    const combined: Order[] = (orderRows as BaseOrder[]).map((o) => ({
      ...o,
      items: (itemRows ?? []).filter((i) => i.order_id === o.id) as OrderItem[],
    }));
    setOrders(combined);
    setLoading(false);
  }

  useEffect(() => {
    loadOrders();
    const channel = supabase
      .channel('cashier')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => loadOrders()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        () => loadOrders()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const activeOrder = orders.find((o) => o.id === activeOrderId) ?? null;

  function openPayment(orderId: number) {
    setActiveOrderId(orderId);
    setMethod(null);
    setReceived('');
  }

  function closePayment() {
    setActiveOrderId(null);
    setMethod(null);
    setReceived('');
  }

  async function confirmPayment() {
    if (!activeOrder || !method) return;
    setProcessing(true);

    const receivedNum = method === 'cash' ? Number(received) : Number(activeOrder.total);
    const change =
      method === 'cash' ? Math.max(0, receivedNum - Number(activeOrder.total)) : 0;

    const { error: payErr } = await supabase.from('payments').insert({
      order_id: activeOrder.id,
      method,
      amount: activeOrder.total,
      received: receivedNum,
      change_given: change,
      status: 'succeeded',
    });

    if (payErr) {
      alert('Payment failed: ' + payErr.message);
      setProcessing(false);
      return;
    }

    const { error: orderErr } = await supabase
      .from('orders')
      .update({
        paid_at: new Date().toISOString(),
        payment_method: method,
        status: 'paid',
      })
      .eq('id', activeOrder.id);

    if (orderErr) {
      alert('Failed to close order: ' + orderErr.message);
      setProcessing(false);
      return;
    }

    setProcessing(false);
    closePayment();
    loadOrders();
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-50 p-6">
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 p-4 md:p-6">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-stone-800">💰 Cashier</h1>
        <span className="text-stone-500 text-sm">
          {orders.length} unpaid {orders.length === 1 ? 'bill' : 'bills'}
        </span>
      </header>

      {orders.length === 0 && (
        <div className="text-center text-stone-400 mt-20">
          <p className="text-xl">No unpaid orders</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {orders.map((order) => (
          <div
            key={order.id}
            className="bg-white rounded-lg p-4 shadow-sm border border-stone-200"
          >
            <div className="flex justify-between items-baseline mb-3">
              <h2 className="text-xl font-bold text-stone-800">
                Table {order.table_number}
              </h2>
              <span className="text-xs text-stone-400 font-mono">#{order.id}</span>
            </div>

            <ul className="space-y-1 mb-3 text-sm text-stone-700">
              {order.items.map((item) => (
                <li key={item.id} className="flex justify-between">
                  <span>
                    <span className="font-mono text-stone-500">{item.qty}x</span>{' '}
                    {item.name_snapshot}
                    {item.name_zh_snapshot && (
                      <span className="text-stone-500"> · {item.name_zh_snapshot}</span>
                    )}
                  </span>
                  <span className="font-mono">
                    RM {(Number(item.price_at_time) * item.qty).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex justify-between font-bold border-t border-stone-100 pt-2 mb-3">
              <span>Total</span>
              <span className="font-mono text-red-700">
                RM {Number(order.total).toFixed(2)}
              </span>
            </div>

            <button
              onClick={() => openPayment(order.id)}
              className="w-full bg-red-700 hover:bg-red-800 text-white font-bold py-2 rounded"
            >
              Take Payment
            </button>
          </div>
        ))}
      </div>

      {/* PAYMENT MODAL */}
      {activeOrder && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
          onClick={closePayment}
        >
          <div
            className="bg-white rounded-lg max-w-md w-full p-6 max-h-[95vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-baseline mb-4">
              <h2 className="text-2xl font-bold">
                Table {activeOrder.table_number}
              </h2>
              <button
                onClick={closePayment}
                className="text-stone-400 hover:text-stone-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* TAX BREAKDOWN */}
            <div className="mb-4 text-sm space-y-1">
              <BreakdownRow label="Subtotal" value={Number(activeOrder.subtotal ?? activeOrder.total)} />
              {Number(activeOrder.service_charge) > 0 && (
                <BreakdownRow label="Service" value={Number(activeOrder.service_charge)} />
              )}
              {Number(activeOrder.tax) > 0 && (
                <BreakdownRow label="SST" value={Number(activeOrder.tax)} />
              )}
              {Number(activeOrder.rounding) !== 0 && (
                <BreakdownRow label="Rounding" value={Number(activeOrder.rounding)} />
              )}
            </div>

            <div className="text-center mb-6 border-t border-b border-stone-100 py-3">
              <p className="text-stone-500 text-sm">Amount due</p>
              <p className="text-4xl font-bold font-mono text-red-700">
                RM {Number(activeOrder.total).toFixed(2)}
              </p>
            </div>

            {!method && (
              <div className="grid grid-cols-3 gap-2">
                <MethodButton onClick={() => setMethod('cash')} emoji="💵" label="Cash" />
                <MethodButton onClick={() => setMethod('duitnow_qr')} emoji="📱" label="DuitNow QR" />
                <MethodButton onClick={() => setMethod('card')} emoji="💳" label="Card" />
              </div>
            )}

            {/* CASH FLOW */}
            {method === 'cash' && (
              <div>
                <label className="block text-sm text-stone-600 mb-1">
                  Cash received (RM)
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                  placeholder={Number(activeOrder.total).toFixed(2)}
                  className="w-full px-3 py-3 text-2xl font-mono border-2 border-stone-300 rounded-lg mb-3"
                  autoFocus
                />
                {received && Number(received) >= Number(activeOrder.total) && (
                  <div className="text-center mb-3 p-3 bg-green-50 rounded">
                    <p className="text-sm text-stone-600">Change to return</p>
                    <p className="text-2xl font-bold font-mono text-green-700">
                      RM {(Number(received) - Number(activeOrder.total)).toFixed(2)}
                    </p>
                  </div>
                )}
                <button
                  onClick={confirmPayment}
                  disabled={
                    processing ||
                    !received ||
                    Number(received) < Number(activeOrder.total)
                  }
                  className="w-full bg-green-700 hover:bg-green-800 disabled:bg-stone-300 text-white font-bold py-3 rounded-lg"
                >
                  {processing ? 'Recording…' : 'Confirm Cash Payment'}
                </button>
              </div>
            )}

            {method === 'duitnow_qr' && (
              <div className="text-center">
                <p className="text-sm text-stone-600 mb-2">
                  Show this QR to the customer
                </p>
                <div className="bg-white border-4 border-red-700 p-6 rounded-lg inline-block mb-3">
                  <div className="w-48 h-48 bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2032%2032%22><rect%20fill=%22white%22%20width=%2232%22%20height=%2232%22/><g%20fill=%22black%22><rect%20x=%220%22%20y=%220%22%20width=%227%22%20height=%227%22/><rect%20x=%222%22%20y=%222%22%20width=%223%22%20height=%223%22%20fill=%22white%22/><rect%20x=%2225%22%20y=%220%22%20width=%227%22%20height=%227%22/><rect%20x=%2227%22%20y=%222%22%20width=%223%22%20height=%223%22%20fill=%22white%22/><rect%20x=%220%22%20y=%2225%22%20width=%227%22%20height=%227%22/><rect%20x=%222%22%20y=%2227%22%20width=%223%22%20height=%223%22%20fill=%22white%22/><rect%20x=%229%22%20y=%222%22%20width=%222%22%20height=%222%22/><rect%20x=%2213%22%20y=%222%22%20width=%222%22%20height=%222%22/><rect%20x=%2217%22%20y=%222%22%20width=%222%22%20height=%222%22/><rect%20x=%2221%22%20y=%222%22%20width=%222%22%20height=%222%22/><rect%20x=%229%22%20y=%229%22%20width=%2214%22%20height=%2214%22/><rect%20x=%2211%22%20y=%2211%22%20width=%2210%22%20height=%2210%22%20fill=%22white%22/><rect%20x=%2213%22%20y=%2213%22%20width=%206%22%20height=%206%22/></g></svg>')] bg-contain bg-no-repeat bg-center"></div>
                </div>
                <p className="text-xs text-stone-400 mb-4">
                  Placeholder QR — connect Fiuu/iPay88 later for real DuitNow QR
                </p>
                <button
                  onClick={confirmPayment}
                  disabled={processing}
                  className="w-full bg-green-700 hover:bg-green-800 disabled:bg-stone-300 text-white font-bold py-3 rounded-lg"
                >
                  {processing ? 'Recording…' : 'Customer Paid — Confirm'}
                </button>
              </div>
            )}

            {method === 'card' && (
              <div className="text-center">
                <div className="bg-stone-100 p-6 rounded-lg mb-4">
                  <p className="text-sm text-stone-600 mb-2">On your card terminal:</p>
                  <p className="text-lg font-bold">Charge</p>
                  <p className="text-3xl font-mono text-red-700">
                    RM {Number(activeOrder.total).toFixed(2)}
                  </p>
                </div>
                <p className="text-xs text-stone-400 mb-4">
                  Once the card is approved on the EDC, press below
                </p>
                <button
                  onClick={confirmPayment}
                  disabled={processing}
                  className="w-full bg-green-700 hover:bg-green-800 disabled:bg-stone-300 text-white font-bold py-3 rounded-lg"
                >
                  {processing ? 'Recording…' : 'Card Approved — Confirm'}
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
          </div>
        </div>
      )}
    </main>
  );
}

function BreakdownRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-stone-600">
      <span>{label}</span>
      <span className="font-mono">RM {value.toFixed(2)}</span>
    </div>
  );
}

function MethodButton({
  onClick,
  emoji,
  label,
}: {
  onClick: () => void;
  emoji: string;
  label: string;
}) {
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
