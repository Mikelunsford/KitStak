// Workspace-switcher membership filtering. F-Wave14-PORTAL-DUALROLE-SWITCH-01
// (prevention half).
//
// The operator Topbar workspace switcher lists every membership getMe()
// returns. A dual-role user (staff in one org, customer_user / vendor_user in
// another) could switch INTO their portal membership from the operator app and
// strand themselves: the portal surface has no workspace switcher, and the
// customer_user / vendor_user roles lack the identity.session.switch
// capability, so the server-side switch-org call has no way back. We therefore
// offer only STAFF memberships as switch targets. Portal access stays on the
// portal sign-in surface, never the operator switcher.
//
// Pure module, no React / apiClient import, so the unit suite stays in the
// element-tree-free lane (mirrors sidebarGating.ts).

import type { RoleCode } from '@/lib/types/identity';

/**
 * Roles that route to a portal surface rather than the operator AppShell.
 * These are external (customer / vendor) identities; they never belong in the
 * operator workspace switcher.
 */
export const PORTAL_ROLE_CODES: ReadonlyArray<RoleCode> = [
  'customer_user',
  'vendor_user',
];

/** True when the role is an operator (staff) role, i.e. not a portal role. */
export function isStaffRole(role: RoleCode): boolean {
  return !PORTAL_ROLE_CODES.includes(role);
}

/**
 * Filter a membership list down to the staff memberships that are safe to
 * offer as workspace-switch targets. Preserves input order and the full row
 * shape so the caller can still render org_id / display_name.
 */
export function staffMemberships<T extends { role: RoleCode }>(
  memberships: ReadonlyArray<T>,
): T[] {
  return memberships.filter((m) => isStaffRole(m.role));
}
