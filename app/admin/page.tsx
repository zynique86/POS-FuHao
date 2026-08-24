import { supabase } from '@/lib/supabase';

// Server component — runs on server, queries Supabase directly
export default async function AdminPage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  // Today's paid orders
  const { data: todayOrders } = await supabase
    .from('orders')
    .select('*')
    .gte('paid_at', todayISO);

  // Today's line items (for best-sellers)
  const { data: allItems } = await supabase
    .from('order_items')
    .select('name_snapshot, qty, price_at_time, order_id');

  // Today's payments (for method breakdown)
  const { data: todayPayments } = await supabase
    .from('payments')
    .select('*')
    .gte('created_at', todayISO);

  const revenue = (todayOrders ?? []).reduce(
    (sum, o) => sum + Number(o.total),
    0
  );
  const orderCount = (todayOrders ?? []).length;
  const avgOrder = orderCount > 0 ? revenue / orderCount : 0;

  // Best sellers today — only count items from today's orders
  const todayOrderIds = new Set((todayOrders ?? []).map((o) => o.id));
  const todayItems = (allItems ?? []).filter((i) => todayOrderIds.has(i.order_id));
  const sellerMap = new Map<string, { qty: number; revenue: number }>();
  for (const i of todayItems) {
    const cur = sellerMap.get(i.name_snapshot) ?? { qty: 0, revenue: 0 };
    cur.qty += i.qty;
    cur.revenue += Number(i.price_at_time) * i.qty;
    sellerMap.set(i.name_snapshot, cur);
  }
  const bestSellers = [...sellerMap.entries()]
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 8);

  // Hourly breakdown
  const hourly = Array(24).fill(0);
  for (const o of todayOrders ?? []) {
    if (o.paid_at) {
      const h = new Date(o.paid_at).getHours();
      hourly[h] += Number(o.total);
    }
  }
  const peakHour = hourly.indexOf(Math.max(...hourly));
  const maxHour = Math.max(...hourly, 1);

  // Payment method split
  const methodMap = new Map<string, number>();
  for (const p of todayPayments ?? []) {
    methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + Number(p.amount));
  }

  return (
    <main className="min-h-screen bg-stone-50 p-4 md:p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-stone-800">📊 Dashboard</h1>
        <p className="text-stone-500 text-sm mt-1">
          Today · {new Date().toLocaleDateString('en-MY', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
      </header>

      {/* STAT TILES */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatTile label="Revenue today" value={`RM ${revenue.toFixed(2)}`} accent />
        <StatTile label="Orders" value={String(orderCount)} />
        <StatTile label="Avg order" value={`RM ${avgOrder.toFixed(2)}`} />
        <StatTile
          label="Peak hour"
          value={orderCount > 0 ? `${peakHour}:00` : '—'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* HOURLY CHART */}
        <section className="bg-white rounded-lg p-6 border border-stone-200">
          <h2 className="text-lg font-bold text-stone-800 mb-4">Revenue by hour</h2>
          {orderCount === 0 ? (
            <p className="text-stone-400 text-sm">No sales yet today.</p>
          ) : (
            <div className="flex items-end gap-1 h-40">
              {hourly.map((val, h) => (
                <div key={h} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-red-700 rounded-t"
                    style={{ height: `${(val / maxHour) * 100}%` }}
                    title={`${h}:00 — RM ${val.toFixed(2)}`}
                  ></div>
                  <span className="text-[9px] text-stone-400 font-mono">
                    {h % 3 === 0 ? h : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* PAYMENT METHODS */}
        <section className="bg-white rounded-lg p-6 border border-stone-200">
          <h2 className="text-lg font-bold text-stone-800 mb-4">Payment methods</h2>
          {methodMap.size === 0 ? (
            <p className="text-stone-400 text-sm">No payments yet today.</p>
          ) : (
            <ul className="space-y-3">
              {[...methodMap.entries()].map(([method, amount]) => {
                const pct = revenue > 0 ? (amount / revenue) * 100 : 0;
                return (
                  <li key={method}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-stone-700 capitalize">
                        {method.replace('_', ' ')}
                      </span>
                      <span className="font-mono text-stone-800">
                        RM {amount.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-2 bg-stone-100 rounded overflow-hidden">
                      <div
                        className="h-full bg-red-700"
                        style={{ width: `${pct}%` }}
                      ></div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* BEST SELLERS */}
        <section className="bg-white rounded-lg p-6 border border-stone-200 lg:col-span-2">
          <h2 className="text-lg font-bold text-stone-800 mb-4">Best sellers today</h2>
          {bestSellers.length === 0 ? (
            <p className="text-stone-400 text-sm">No items sold yet today.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-stone-500 border-b border-stone-100">
                  <th className="pb-2 font-normal">Item</th>
                  <th className="pb-2 font-normal text-right">Qty sold</th>
                  <th className="pb-2 font-normal text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {bestSellers.map(([name, stats]) => (
                  <tr key={name} className="border-b border-stone-50 last:border-0">
                    <td className="py-2 text-stone-800">{name}</td>
                    <td className="py-2 text-right font-mono">{stats.qty}</td>
                    <td className="py-2 text-right font-mono text-red-700">
                      RM {stats.revenue.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg p-4 border ${
        accent
          ? 'bg-red-700 text-white border-red-800'
          : 'bg-white text-stone-800 border-stone-200'
      }`}
    >
      <p
        className={`text-xs uppercase tracking-wider ${
          accent ? 'text-red-100' : 'text-stone-500'
        }`}
      >
        {label}
      </p>
      <p className="text-2xl font-bold font-mono mt-1">{value}</p>
    </div>
  );
}
