import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// ★  ADMIN EMAIL LIST — keep in sync with lib/roles.ts  ★
// ---------------------------------------------------------------------------
// Middleware runs before Next.js loads any app code, so it can't import
// from lib/roles.ts (that would pull in client code).  Keep the list
// identical here.
const ADMIN_EMAILS = new Set([
  'ezjiet@gmail.com',
  'poyee4963@gmail.com',
  'rickytan5791@gmail.com',
  'tan523567@gmail.com',
].map((s) => s.toLowerCase()));

// Routes that DON'T need auth.  Everything else does.
const PUBLIC_PATHS = ['/login'];

// Routes that require admin role in addition to auth.
const ADMIN_PATHS = ['/admin'];

// ---------------------------------------------------------------------------
// Runs on EVERY request before the page is rendered.
// This is server-side, so users can't bypass it by editing the URL or
// using devtools — the redirect happens before any HTML reaches the browser.
// ---------------------------------------------------------------------------
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Let static assets, favicons, etc. through untouched.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Prepare the response early so we can attach refreshed cookies to it.
  const res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          list.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Refresh the session if needed (extends idle sessions transparently).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );
  const isAdminRoute = ADMIN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  // 1. No user → send to /login (unless the request is already for a public page)
  if (!user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);  // remember where they wanted to go
    return NextResponse.redirect(url);
  }

  // 2. User signed in but hits /login → bounce to home
  if (user && pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // 3. Non-admin user hitting an /admin route → bounce home
  if (user && isAdminRoute) {
    const email = (user.email ?? '').toLowerCase();
    if (!ADMIN_EMAILS.has(email)) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
  }

  return res;
}

// Restrict the middleware to page routes (skip API + static).
export const config = {
  matcher: [
    /*
     * Match every path except:
     *  - _next/static, _next/image
     *  - favicon.ico
     *  - files with an extension (images, css, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.).*)',
  ],
};
