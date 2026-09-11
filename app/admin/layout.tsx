'use client';

// PIN gate for every /admin/* route. Once the manager enters a valid
// PIN, it's remembered in sessionStorage for the rest of this browser
// session — no repeat prompts as they move between admin pages.
// Bypass entirely if no manager/admin staff rows exist yet (fresh setup).

import { useEffect, useState } from 'react';
import PinPad from '@/components/pin-pad';
import { verifyManagerPin } from '@/lib/staff';
import { supabase } from '@/lib/supabase';

const KEY = 'pos:admin-pin-ok';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    // Already unlocked this session?
    if (typeof window !== 'undefined' && sessionStorage.getItem(KEY) === '1') {
      setOk(true);
      return;
    }
    // If no manager/admin staff row exists, don't gate (setup phase).
    supabase
      .from('staff')
      .select('id', { count: 'exact', head: true })
      .in('role', ['manager', 'admin'])
      .eq('active', true)
      .then(({ count }) => {
        if ((count ?? 0) === 0) {
          setOk(true);
          return;
        }
        setOk(false);
      });
  }, []);

  if (ok === null) {
    return (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center text-[var(--ink-500)]">
        Checking access…
      </div>
    );
  }

  if (!ok) {
    return (
      <PinPad
        title="Manager PIN"
        sub="Enter a manager or admin PIN to open the dashboard."
        onVerify={async (pin) => {
          const s = await verifyManagerPin(pin);
          if (!s) return 'PIN not recognised';
          sessionStorage.setItem(KEY, '1');
          setOk(true);
          return null;
        }}
      />
    );
  }

  return <>{children}</>;
}
