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

// -------------------------------------------------------------------------
// ★  EDIT THIS LIST WHEN YOU HIRE OR PROMOTE PEOPLE  ★
// -------------------------------------------------------------------------

const ADMIN_EMAILS = [
  'ezjiet@gmail.com',
  'poyee4963@gmail.com',
  'rickytan5791@gmail.com',
  'tan523567@gmail.com'
] as const;

// -------------------------------------------------------------------------

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

function normalise(e: string | null): string {
  return (e ?? '').trim().toLowerCase();
}

export async function getCurrentUser(force = false): Promise<CurrentUser> {
  if (cache && !force) return cache;

  const { data: sess } = await supabase.auth.getSession();
  const user = sess?.session?.user;
  const email = user?.email ?? null;
  const meta = (user?.user_metadata ?? {}) as { name?: string };

  // Role: whitelisted email → admin; everyone else → staff.
  const isAdmin = ADMIN_EMAILS.map(normalise).includes(normalise(email));
  const role: StaffRole = isAdmin ? 'admin' : 'staff';

  // Name: user_metadata.name if set, else email prefix.
  const name = (meta.name && meta.name.trim()) || nameFromEmail(email);

  cache = { email, role, name };
  return cache;
}

export function clearRoleCache() {
  cache = null;
}

// Capability check — admin can do anything, staff blocked from admin pages.
export type Capability =
  | 'view_pos' | 'view_kitchen' | 'view_bar' | 'view_cashier'
  | 'view_admin' | 'view_reports' | 'view_profit'
  | 'edit_menu' | 'edit_expenses' | 'edit_settings'
  | 'void' | 'refund' | 'discount' | 'change_price';

const ADMIN_ONLY: Capability[] = [
  'view_admin', 'view_reports', 'view_profit',
  'edit_menu', 'edit_expenses', 'edit_settings',
  'change_price',
];

export function can(role: StaffRole, capability: Capability): boolean {
  if (role === 'admin') return true;
  return !ADMIN_ONLY.includes(capability);
}
