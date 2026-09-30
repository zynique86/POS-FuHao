import { createBrowserClient } from '@supabase/ssr';

// Cookie-based Supabase client (via @supabase/ssr).
// The session lives in an httpOnly cookie the Next.js middleware can read,
// so route guards actually run on the server BEFORE the page HTML is sent.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
