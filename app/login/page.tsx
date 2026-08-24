'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

    router.push('/');
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 to-amber-100 flex items-center justify-center p-4">
      <form
        onSubmit={onSubmit}
        className="bg-white rounded-2xl shadow-lg border border-amber-100 p-8 max-w-sm w-full"
      >
        <div className="text-center mb-6">
          <div className="text-5xl mb-2">🥟</div>
          <h1 className="text-3xl font-bold text-red-800">Dim Sum POS</h1>
          <p className="text-stone-500 text-sm mt-1">Staff sign-in</p>
        </div>

        <label className="block text-sm text-stone-600 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="username"
          className="w-full px-3 py-3 border border-stone-300 rounded-lg mb-3 text-base"
        />

        <label className="block text-sm text-stone-600 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="w-full px-3 py-3 border border-stone-300 rounded-lg mb-3 text-base"
        />

        {error && (
          <p className="text-red-700 text-sm mb-3 bg-red-50 p-2 rounded">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-red-700 hover:bg-red-800 disabled:bg-stone-300 text-white font-bold py-3 rounded-lg text-base"
        >
          {busy ? 'Signing in…' : 'Sign In'}
        </button>

        <p className="text-xs text-stone-400 mt-4 text-center">
          New staff accounts are created by the manager in the Supabase dashboard.
        </p>
      </form>
    </main>
  );
}
