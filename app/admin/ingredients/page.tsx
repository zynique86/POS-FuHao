'use client';

// Ingredients feature was removed. This stub redirects back to the
// admin dashboard so any old bookmarks land somewhere sensible.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function IngredientsRemoved() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin');
  }, [router]);
  return (
    <main className="min-h-[calc(100vh-56px)] flex items-center justify-center">
      <p className="text-[var(--ink-500)] text-sm">Redirecting…</p>
    </main>
  );
}
