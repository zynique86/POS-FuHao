// Role lookup — used by pages that need to gate features by permission tier.
//
// Every signed-in user is joined against the `staff` table by user_id to find
// their role.  If the row is missing we assume the safest default: cashier.
// Owners have full access; supervisors can void/refund/discount; cashiers can
// only take orders and payments.

import { supabase } from './supabase';
import type { StaffRole } from './types';

export type CurrentUser = {
  email: string | null;
  role: StaffRole;
  name: string | null;
};

let cache: CurrentUser | null = null;

export async function getCurrentUser(force = false): Promise<CurrentUser> {
  if (cache && !force) return cache;

  const { data: sess } = await supabase.auth.getSession();
  const email = sess?.session?.user?.email ?? null;
  const uid = sess?.session?.user?.id ?? null;

  let role: StaffRole = 'cashier';
  let name: string | null = email;

  if (uid) {
    const { data } = await supabase
      .from('staff')
      .select('name, role')
      .eq('user_id', uid)
      .maybeSingle();
    if (data?.role) role = data.role as StaffRole;
    if (data?.name) name = data.name;
  }

  cache = { email, role, name };
  return cache;
}

export function clearRoleCache() {
  cache = null;
}

// --- Permission helpers ---------------------------------------------------

export function can(role: StaffRole, capability: Capability): boolean {
  return CAPABILITIES[capability].includes(role);
}

export type Capability =
  | 'view_pos'          // waiter can take orders
  | 'view_kitchen'      // watch station
  | 'view_bar'
  | 'view_cashier'      // take payments
  | 'void'              // cancel a sent order
  | 'refund'            // refund a paid order
  | 'discount'          // apply a discount at cashier
  | 'change_price'      // edit prices in menu
  | 'edit_menu'         // add / edit menu items
  | 'view_admin'        // see admin index
  | 'view_reports'      // dashboards & reports
  | 'view_profit'       // monthly profit + expenses
  | 'edit_expenses'     // enter wages, purchases, etc.
  | 'edit_staff'        // manage staff roles
  | 'view_audit'        // audit log
  | 'edit_settings';

const CAPABILITIES: Record<Capability, StaffRole[]> = {
  view_pos:       ['cashier', 'supervisor', 'owner'],
  view_kitchen:   ['cashier', 'supervisor', 'owner'],
  view_bar:       ['cashier', 'supervisor', 'owner'],
  view_cashier:   ['cashier', 'supervisor', 'owner'],
  void:           ['supervisor', 'owner'],
  refund:         ['supervisor', 'owner'],
  discount:       ['supervisor', 'owner'],
  change_price:   ['owner'],
  edit_menu:      ['supervisor', 'owner'],
  view_admin:     ['supervisor', 'owner'],
  view_reports:   ['supervisor', 'owner'],
  view_profit:    ['owner'],
  edit_expenses:  ['owner'],
  edit_staff:     ['owner'],
  view_audit:     ['owner'],
  edit_settings:  ['owner'],
};
