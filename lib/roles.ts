// Role lookup — SIMPLIFIED.
//
// Anyone signed in to Supabase Auth gets full access.  No role tiers.
// The `can()` helper always returns true so existing call sites keep
// compiling and every gated action is allowed.
//
// If you ever want to bring roles back, restore the earlier version
// from git history.

import { supabase } from './supabase';
import type { StaffRole } from './types';

export type CurrentUser = {
  email: string | null;
  role: StaffRole;   // always 'owner' in this simplified build
  name: string | null;
};

let cache: CurrentUser | null = null;

export async function getCurrentUser(force = false): Promise<CurrentUser> {
  if (cache && !force) return cache;

  const { data: sess } = await supabase.auth.getSession();
  const email = sess?.session?.user?.email ?? null;

  cache = { email, role: 'owner', name: email };
  return cache;
}

export function clearRoleCache() {
  cache = null;
}

// Capability check — always allows.  Kept as a function so existing
// `can(role, 'refund')` call sites don't need to be edited.
export type Capability =
  | 'view_pos' | 'view_kitchen' | 'view_bar' | 'view_cashier'
  | 'void' | 'refund' | 'discount' | 'change_price' | 'edit_menu'
  | 'view_admin' | 'view_reports' | 'view_profit' | 'edit_expenses'
  | 'edit_staff' | 'view_audit' | 'edit_settings';

export function can(_role: StaffRole, _capability: Capability): boolean {
  return true;
}
