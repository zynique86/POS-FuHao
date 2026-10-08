'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchSettings } from '@/lib/settings';

// Only allow same-origin, root-relative paths. Rejects protocol-relative
// (`//foo`), backslash-prefixed (`/\\foo`), and anything that isn't a `/…` path.
function safeNext(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shop, setShop] = useState<{ name: string; nameZh: string }>({
    name: 'Dim Sum POS',
    nameZh: '點心 · Staff sign-in',
  });

  useEffect(() => {
    fetchSettings().then((s) => {
      setShop({
        name: s.shop_name || 'Dim Sum POS',
        nameZh: (s.shop_name_zh || '點心') + ' · Staff sign-in',
      });
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background:
          'radial-gradient(1200px 700px at 20% 20%, rgb(251 191 36 / 0.20), transparent 60%), radial-gradient(900px 600px at 90% 90%, rgb(220 38 38 / 0.14), transparent 60%), var(--cream-100)',
      }}
    >
      {/* Decorative floating dumpling glyphs */}
      <div aria-hidden className="absolute inset-0 pointer-events-none select-none">
        <span className="absolute top-[12%] left-[8%] text-6xl opacity-10">🥟</span>
        <span className="absolute bottom-[15%] right-[10%] text-7xl opacity-10">🫖</span>
        <span className="absolute top-[65%] left-[12%] text-5xl opacity-10">🥢</span>
      </div>

      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-sm bg-white rounded-[var(--r-2xl)] p-8 animate-rise"
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="text-center mb-7">
          <div
            className="inline-flex w-16 h-16 rounded-2xl items-center justify-center text-4xl mb-3"
            style={{
              background:
                'linear-gradient(135deg, var(--brand-600), var(--brand-800))',
              boxShadow: 'var(--shadow-brand)',
            }}
          >
            🥟
          </div>
          <h1 className="text-2xl font-bold text-[var(--ink-900)]">{shop.name}</h1>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-500)] mt-1">
            {shop.nameZh}
          </p>
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-500)] mb-1">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="username"
          className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl mb-4 text-base focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)] transition"
        />

        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-500)] mb-1">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="w-full px-4 py-3 border border-[var(--ink-200)] rounded-xl mb-4 text-base focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-100)] transition"
        />

        {error && (
          <div className="text-[var(--brand-700)] text-sm mb-4 bg-[var(--brand-50)] border border-[var(--brand-100)] p-3 rounded-xl">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full text-white font-bold py-3 rounded-xl text-base transition disabled:opacity-60"
          style={{
            background:
              'linear-gradient(135deg, var(--brand-600), var(--brand-700))',
            boxShadow: 'var(--shadow-brand)',
          }}
        >
          {busy ? 'Signing in…' : 'Sign In'}
        </button>

        <p className="text-xs text-[var(--ink-400)] mt-5 text-center">
          Ask your manager to create new staff accounts in Supabase.
        </p>
      </form>
    </main>
  );
}
