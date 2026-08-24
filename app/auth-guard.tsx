'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// Wraps any page that requires a signed-in staff member.
// Redirects to /login if not authenticated. Shows a signout bar at the top.
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isLoginRoute = pathname === '/login';

  const [checked, setChecked] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    // The /login route is public — never gate it, or we deadlock:
    // no session → redirect to /login → still no session → "Checking…" forever.
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
        // Network/env failure — surface it to the user instead of
        // hanging on the checking screen.
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
      <div className="min-h-screen bg-amber-50 flex items-center justify-center">
        <p className="text-stone-500">Checking sign-in…</p>
      </div>
    );
  }

  // Login route: no nav bar, no sign-out — just render the form.
  if (isLoginRoute) {
    return <>{children}</>;
  }

  return (
    <>
      <div className="bg-stone-800 text-white text-xs px-4 py-2 flex justify-between items-center">
        <div className="flex gap-4">
          <a href="/" className={link(pathname === '/')}>POS</a>
          <a href="/kitchen" className={link(pathname === '/kitchen')}>Kitchen</a>
          <a href="/cashier" className={link(pathname === '/cashier')}>Cashier</a>
          <a href="/admin" className={link(pathname?.startsWith('/admin') ?? false)}>Dashboard</a>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-stone-400">{email}</span>
          <button onClick={signOut} className="hover:text-amber-300">
            Sign out
          </button>
        </div>
      </div>
      {children}
    </>
  );

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }
}

function link(active: boolean) {
  return active
    ? 'text-amber-300 font-bold'
    : 'text-stone-300 hover:text-white';
}
