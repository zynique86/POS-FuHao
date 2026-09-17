// Admin layout — no PIN gate anymore.
//
// Supabase Auth already guards every page via `app/auth-guard.tsx`:
// if you're not signed in, you're bounced to /login.  That's the only
// access check the admin section uses.

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
