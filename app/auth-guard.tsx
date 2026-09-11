'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// Wraps every page. Enforces sign-in and paints the global top nav.
// The /login route is a passthrough — no nav, no session gate.
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isLoginRoute = pathname === '/login';

  const [checked, setChecked] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (isLoginRoute) {
      setChecked(true);
      return;
    }
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data.session) {
          router.replace('/login');
          return;
        }
        setEmail(data.session.user.email ?? null);
        setChecked(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Auth check failed:', err);
        router.replace('/login');
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace('/login');
      else setEmail(session.user.email ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [isLoginRoute, router]);

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

  const initial = (email ?? 'S').trim()[0]?.toUpperCase() ?? 'S';

  return (
    <>
      <header className="sticky top-0 z-40 backdrop-blur bg-[var(--cream-50)]/85 border-b border-[var(--ink-200)]">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between px-4 md:px-6 h-14">
          <a href="/" className="flex items-center gap-2 group">
            <span
              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-xl"
              style={{
                background:
                  'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
                boxShadow: 'var(--shadow-brand)',
              }}
            >
              🥟
            </span>
            <span className="hidden sm:flex flex-col leading-tight">
              <span className="font-bold text-[var(--ink-900)] text-sm">
                Dim Sum POS
              </span>
              <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--ink-500)]">
                點心 · Point of Sale
              </span>
            </span>
          </a>

          <nav className="flex items-center gap-1">
            <NavLink href="/"        active={pathname === '/'}                        label="POS" />
            <NavLink href="/kitchen" active={pathname === '/kitchen'}                 label="Kitchen" />
            <NavLink href="/bar"     active={pathname === '/bar'}                     label="Bar" />
            <NavLink href="/restock" active={pathname === '/restock'}                 label="Restock" />
            <NavLink href="/cashier" active={pathname === '/cashier'}                 label="Cashier" />
            <NavLink href="/admin"   active={pathname?.startsWith('/admin') ?? false} label="Admin" />
          </nav>

          <div className="flex items-center gap-2">
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
              style={{
                background:
                  'linear-gradient(135deg, var(--brand-500), var(--brand-700))',
              }}
              title={email ?? ''}
            >
              {initial}
            </span>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                router.replace('/login');
              }}
              className="text-xs text-[var(--ink-500)] hover:text-[var(--brand-600)] font-medium hidden sm:block"
            >
              Sign out
            </button>
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
      className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
        active
          ? 'bg-[var(--brand-600)] text-white shadow-sm'
          : 'text-[var(--ink-700)] hover:bg-[var(--cream-200)]'
      }`}
    >
      {label}
    </a>
  );
}
