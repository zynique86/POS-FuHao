import Dashboard from './dashboard';

export default function AdminPage() {
  return (
    <main className="min-h-[calc(100vh-56px)] max-w-[1800px] mx-auto px-4 md:px-8 py-8">
      <header className="mb-8 flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-[var(--ink-500)]">
            Manager · 老闆
          </p>
          <h1 className="text-4xl md:text-5xl font-bold text-[var(--ink-900)] mt-2 tracking-tight">
            Dashboard
          </h1>
          <p className="text-sm text-[var(--ink-500)] mt-2">
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
          <NavCard href="/admin/staff" emoji="👤" label="Staff" />
          <NavCard href="/admin/settings" emoji="⚙️" label="Settings" />
        </nav>
      </header>

      <Dashboard />
    </main>
  );
}

function NavCard({ href, emoji, label }: { href: string; emoji: string; label: string }) {
  return (
    <a
      href={href}
      className="card-hover flex items-center gap-2 px-4 py-3 rounded-2xl bg-white border border-[var(--ink-200)] text-[var(--ink-800)] font-semibold text-sm"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <span className="text-base">{emoji}</span>
      {label}
    </a>
  );
}
