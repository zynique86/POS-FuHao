'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchSettings } from '@/lib/settings';
import { getCurrentUser, clearRoleCache, type CurrentUser } from '@/lib/roles';

// Wraps every page.  Enforces sign-in, applies role-based redirects, and
// paints the global top nav.  The /login route is a passthrough — no nav,
// no session gate.
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isLoginRoute = pathname === '/login';

  const [checked, setChecked] = useState(false);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [shop, setShop] = useState<{ name: string; nameZh: string }>({
    name: 'Dim Sum POS',
    nameZh: '點心 · Point of Sale',
  });

  useEffect(() => {
    if (isLoginRoute) return;
    let cancelled = false;
    async function load() {
      const s = await fetchSettings();
      if (!cancelled) {
        setShop({
          name: s.shop_name || 'Dim Sum POS',
          nameZh: s.shop_name_zh || '點心 · Point of Sale',
        });
      }
    }
    load();
    const channel = supabase
      .channel('nav-settings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shop_settings' },
        () => load()
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [isLoginRoute]);

  useEffect(() => {
    if (isLoginRoute) {
      setChecked(true);
      return;
    }
    let cancelled = false;

    async function refresh() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        router.replace('/login');
        return;
      }
      clearRoleCache();
      const u = await getCurrentUser(true);
      if (cancelled) return;
      setMe(u);
      setChecked(true);

      // Route guard: staff can't visit any admin page.
      if (u.role !== 'admin' && pathname?.startsWith('/admin')) {
        router.replace('/');
      }
    }

    refresh();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace('/login');
      else refresh();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [isLoginRoute, router, pathname]);

  // Close the profile menu on an outside click, or when the route changes.
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-[var(--ink-500)]">
          <span className="inline-block w-3 h-3 rounded-full bg-[var(--brand-500)] animate-pulse"></span>
          <span className="text-sm">Checking sign-in…</span>
        </div>
      </div>
    );
  }

  if (isLoginRoute) return <>{children}</>;

  const initial = (me?.name ?? me?.email ?? 'S').trim()[0]?.toUpperCase() ?? 'S';
  const isAdmin = me?.role === 'admin';

  return (
    <>
      <header className="sticky top-0 z-40 backdrop-blur bg-[var(--cream-50)]/85 border-b border-[var(--ink-200)]">
        <div className="max-w-[1600px] mx-auto flex items-center gap-3 px-3 md:px-6 h-14">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span
              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-xl shrink-0"
              style={{
                background:
                  'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
                boxShadow: 'var(--shadow-brand)',
              }}
            >
              🥟
            </span>
            <span className="hidden md:flex flex-col leading-tight min-w-0">
              <span className="font-bold text-[var(--ink-900)] text-sm truncate max-w-[160px]">
                {shop.name}
              </span>
              <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--ink-500)] truncate max-w-[160px]">
                {shop.nameZh}
              </span>
            </span>
          </Link>

          {/* Nav pills — scroll horizontally when they don't fit */}
          <nav className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
            <NavLink href="/"        active={pathname === '/'}                        label="POS" />
            <NavLink href="/front-kitchen" active={pathname === '/front-kitchen'}     label="Front Kitchen" />
            <NavLink href="/kitchen" active={pathname === '/kitchen'}                 label="Back Kitchen" />
            <NavLink href="/bar"     active={pathname === '/bar'}                     label="Bar" />
            <NavLink href="/restock" active={pathname === '/restock'}                 label="Restock" />
            <NavLink href="/cashier" active={pathname === '/cashier'}                 label="Cashier" />
            {isAdmin && (
              <NavLink href="/admin" active={pathname?.startsWith('/admin') ?? false} label="Admin" />
            )}
          </nav>

          <div className="relative flex items-center gap-2 shrink-0" ref={menuRef}>
            {me?.name && (
              <span className="hidden md:flex flex-col leading-tight text-right">
                <span className="text-xs font-bold text-[var(--ink-900)] truncate max-w-[140px]">
                  {me.name}
                </span>
                <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--ink-500)]">
                  {isAdmin ? '👑 Admin' : '👤 Staff'}
                </span>
              </span>
            )}
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={menuOpen}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
              style={{
                background: isAdmin
                  ? 'linear-gradient(135deg, var(--brand-500), var(--brand-700))'
                  : 'linear-gradient(135deg, var(--ink-500), var(--ink-700))',
              }}
              title={me?.email ?? ''}
            >
              {initial}
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-[calc(100%+8px)] w-48 rounded-xl border border-[var(--ink-200)] bg-[var(--cream-50)] py-1.5 shadow-lg z-50"
              >
                <div className="px-3 py-2 border-b border-[var(--ink-200)]">
                  <p className="text-xs font-bold text-[var(--ink-900)] truncate">
                    {me?.name}
                  </p>
                  <p className="text-[10px] text-[var(--ink-500)] truncate">
                    {me?.email}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    await supabase.auth.signOut();
                    clearRoleCache();
                    router.replace('/login');
                  }}
                  className="w-full text-left px-3 py-2 text-sm font-medium text-[var(--ink-700)] hover:bg-[var(--cream-200)]"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {children}
    </>
  );
}

function NavLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <a
      href={href}
      className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors whitespace-nowrap ${
        active
          ? 'bg-[var(--brand-600)] text-white shadow-sm'
          : 'text-[var(--ink-700)] hover:bg-[var(--cream-200)]'
      }`}
    >
      {label}
    </a>
  );
}
