import { supabase } from '@/lib/supabase';

// Server component — snapshot of today's business.
export default async function AdminPage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const { data: todayOrders } = await supabase
    .from('orders')
    .select('*')
    .gte('paid_at', todayISO);

  const { data: allItems } = await supabase
    .from('order_items')
    .select('name_snapshot, qty, price_at_time, order_id, voided_at');

  const { data: todayPayments } = await supabase
    .from('payments')
    .select('*')
    .gte('created_at', todayISO);

  const revenue = (todayOrders ?? []).reduce((s, o) => s + Number(o.total), 0);
  const orderCount = (todayOrders ?? []).length;
  const avgOrder = orderCount > 0 ? revenue / orderCount : 0;

  const todayOrderIds = new Set((todayOrders ?? []).map((o) => o.id));
  const todayItems = (allItems ?? []).filter((i) => todayOrderIds.has(i.order_id));

  const sellerMap = new Map<string, { qty: number; revenue: number }>();
  for (const i of todayItems) {
    if (i.voided_at) continue;
    const cur = sellerMap.get(i.name_snapshot) ?? { qty: 0, revenue: 0 };
    cur.qty += i.qty;
    cur.revenue += Number(i.price_at_time) * i.qty;
    sellerMap.set(i.name_snapshot, cur);
  }
  const bestSellers = [...sellerMap.entries()]
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 8);

  const hourly = Array(24).fill(0);
  for (const o of todayOrders ?? []) {
    if (o.paid_at) {
      const h = new Date(o.paid_at).getHours();
      hourly[h] += Number(o.total);
    }
  }
  const peakHour = hourly.indexOf(Math.max(...hourly));
  const maxHour = Math.max(...hourly, 1);

  const methodMap = new Map<string, number>();
  for (const p of todayPayments ?? []) {
    methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + Number(p.amount));
  }

  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1600px] mx-auto px-4 md:px-6 py-6">
      <header className="mb-8 flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-500)]">
            Manager · 老闆
          </p>
          <h1 className="text-3xl md:text-4xl font-bold text-[var(--ink-900)] mt-1">
            Today at a glance
          </h1>
          <p className="text-sm text-[var(--ink-500)] mt-1">
            {new Date().toLocaleDateString('en-MY', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>
        <nav className="flex flex-wrap gap-2 no-print">
          <NavCard href="/admin/menu" emoji="🥟" label="Menu" />
          <NavCard href="/admin/z-report" emoji="📋" label="Z-Report" />
          <NavCard href="/admin/settings" emoji="⚙️" label="Settings" />
        </nav>
      </header>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <BigTile label="Revenue" value={`RM ${revenue.toFixed(2)}`} accent />
        <BigTile label="Orders" value={String(orderCount)} />
        <BigTile label="Avg order" value={`RM ${avgOrder.toFixed(2)}`} />
        <BigTile
          label="Peak hour"
          value={orderCount > 0 ? `${peakHour}:00` : '—'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hourly chart */}
        <section className="bg-white rounded-3xl p-6 border border-[var(--ink-200)]" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="flex justify-between items-baseline mb-5">
            <h2 className="text-lg font-bold text-[var(--ink-900)]">Revenue by hour</h2>
            <span className="text-xs text-[var(--ink-400)]">Today</span>
          </div>
          {orderCount === 0 ? (
            <EmptyChart label="No sales yet today." />
          ) : (
            <div className="flex items-end gap-1 h-44">
              {hourly.map((val, h) => {
                const pct = (val / maxHour) * 100;
                const isPeak = h === peakHour && val > 0;
                return (
                  <div key={h} className="flex-1 flex flex-col items-center gap-1 min-w-0 group">
                    <div className="w-full flex items-end h-40">
                      <div
                        className="w-full rounded-t-lg transition-all"
                        style={{
                          height: `${Math.max(pct, val > 0 ? 4 : 0)}%`,
                          background: isPeak
                            ? 'linear-gradient(180deg, var(--brand-500), var(--brand-700))'
                            : 'linear-gradient(180deg, var(--brand-400), var(--brand-600))',
                          opacity: val === 0 ? 0.15 : 1,
                        }}
                        title={`${h}:00 — RM ${val.toFixed(2)}`}
                      ></div>
                    </div>
                    <span className={`text-[9px] font-mono ${isPeak ? 'text-[var(--brand-700)] font-bold' : 'text-[var(--ink-400)]'}`}>
                      {h % 3 === 0 ? h : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Payment methods */}
        <section className="bg-white rounded-3xl p-6 border border-[var(--ink-200)]" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="flex justify-between items-baseline mb-5">
            <h2 className="text-lg font-bold text-[var(--ink-900)]">Payment methods</h2>
            <span className="text-xs text-[var(--ink-400)]">Today</span>
          </div>
          {methodMap.size === 0 ? (
            <EmptyChart label="No payments yet today." />
          ) : (
            <ul className="space-y-4">
              {[...methodMap.entries()].map(([method, amount]) => {
                const pct = revenue > 0 ? (amount / revenue) * 100 : 0;
                return (
                  <li key={method}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-[var(--ink-700)] capitalize font-semibold">
                        {method.replace('_', ' ')}
                      </span>
                      <span className="font-mono text-[var(--ink-800)]">
                        RM {amount.toFixed(2)}
                        <span className="text-[var(--ink-400)] ml-2 text-xs">{pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="h-2.5 bg-[var(--ink-100)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          background:
                            'linear-gradient(90deg, var(--brand-500), var(--brand-700))',
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Best sellers */}
        <section className="bg-white rounded-3xl p-6 border border-[var(--ink-200)] lg:col-span-2" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="flex justify-between items-baseline mb-5">
            <h2 className="text-lg font-bold text-[var(--ink-900)]">Best sellers today</h2>
            <span className="text-xs text-[var(--ink-400)]">Top 8</span>
          </div>
          {bestSellers.length === 0 ? (
            <EmptyChart label="No items sold yet today." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--ink-500)] border-b border-[var(--ink-100)]">
                  <th className="pb-3 font-normal text-xs uppercase tracking-widest">Item</th>
                  <th className="pb-3 font-normal text-xs uppercase tracking-widest text-right">Qty</th>
                  <th className="pb-3 font-normal text-xs uppercase tracking-widest text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {bestSellers.map(([name, stats], idx) => (
                  <tr key={name} className="border-b border-[var(--ink-100)]/60 last:border-0">
                    <td className="py-3 text-[var(--ink-800)]">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center ${
                            idx === 0
                              ? 'bg-[var(--gold-400)] text-black'
                              : idx < 3
                              ? 'bg-[var(--brand-100)] text-[var(--brand-700)]'
                              : 'bg-[var(--ink-100)] text-[var(--ink-500)]'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="font-semibold">{name}</span>
                      </span>
                    </td>
                    <td className="py-3 text-right font-mono text-[var(--ink-700)]">{stats.qty}</td>
                    <td className="py-3 text-right font-mono text-[var(--brand-700)] font-semibold">
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

function BigTile({
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
      className={`rounded-3xl p-5 ${accent ? 'text-white' : 'bg-white text-[var(--ink-900)] border border-[var(--ink-200)]'}`}
      style={
        accent
          ? {
              background:
                'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
              boxShadow: 'var(--shadow-brand)',
            }
          : { boxShadow: 'var(--shadow-sm)' }
      }
    >
      <p
        className={`text-[10px] uppercase tracking-[0.2em] ${
          accent ? 'text-white/70' : 'text-[var(--ink-500)]'
        } font-semibold`}
      >
        {label}
      </p>
      <p className="text-3xl font-bold font-mono mt-2 leading-none">{value}</p>
    </div>
  );
}

function NavCard({ href, emoji, label }: { href: string; emoji: string; label: string }) {
  return (
    <a
      href={href}
      className="card-hover flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white border border-[var(--ink-200)] text-[var(--ink-800)] font-semibold text-sm"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <span className="text-base">{emoji}</span>
      {label}
    </a>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="text-center py-8 text-[var(--ink-400)] text-sm">
      {label}
    </div>
  );
}
