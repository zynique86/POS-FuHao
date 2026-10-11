// Role lookup — two-role system, admins whitelisted by email.
//
// The list of admin emails below is the ONLY thing that decides who is
// an admin.  Add or remove emails here and redeploy.  No Supabase
// metadata editing required.
//
// Everyone else who signs in is treated as `staff` — full access to
// POS / Kitchen / Bar / Cashier / Restock, blocked from /admin/*.
//
// The name shown on orders and in the top nav comes from either:
//   • The user's user_metadata.name in Supabase (if set), or
//   • The part of their email before the `@` (fallback).

import { supabase } from './supabase';
import type { StaffRole } from './types';
import { ADMIN_EMAILS, isAdminEmail } from './admin-emails';

// Re-exported so existing importers of `lib/roles` keep working.
// ★ Edit the list in lib/admin-emails.ts ★
export { ADMIN_EMAILS, isAdminEmail };

export type CurrentUser = {
  email: string | null;
  role: StaffRole;
  name: string | null;
};

let cache: CurrentUser | null = null;

function nameFromEmail(email: string | null): string | null {
  if (!email) return null;
  return email.split('@')[0] || email;
}

export async function getCurrentUser(force = false): Promise<CurrentUser> {
  if (cache && !force) return cache;

  const { data: sess } = await supabase.auth.getSession();
  const user = sess?.session?.user;
  const email = user?.email ?? null;
  const meta = (user?.user_metadata ?? {}) as { name?: string };

  // Role: whitelisted email → admin; everyone else → staff.
  const role: StaffRole = isAdminEmail(email) ? 'admin' : 'staff';

  // Name: user_metadata.name if set, else email prefix.
  const name = (meta.name && meta.name.trim()) || nameFromEmail(email);

  cache = { email, role, name };
  return cache;
}

export function clearRoleCache() {
  cache = null;
}
