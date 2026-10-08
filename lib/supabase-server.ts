// Server-side Supabase client — for use in Server Components, Route Handlers,
// and anywhere else that runs on the server (NOT client components).
//
// This mirrors the cookie bridge used by middleware.ts, so SSR fetches run
// as the signed-in user and RLS policies apply correctly.  The browser client
// in ./supabase.ts cannot do this: it has no access to the request's cookies,
// which on Vercel means fetches run with no session at all.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          try {
            list.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // `set` throws from Server Components that aren't inside a Route
            // Handler or Server Action.  Middleware refreshes the session, so
            // ignoring this here is safe for read-only SSR pages.
          }
        },
      },
    }
  );
}
