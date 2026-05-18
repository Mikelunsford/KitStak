import { useMemo } from 'react';

import { useAuthOptional } from '@/auth/AuthContext';
import {
  hasVendorsInventoryOpsCap,
  type VendorsInventoryOpsCapability,
  type RoleCode,
} from '@/lib/capabilities/vendors_inventory_ops';
import { useMe } from './useMe';

/**
 * Vendors / inventory / ops side-car capability hook. Returns a memoised
 * `can(cap)` predicate against the active role from useMe.
 *
 * Parallels useCapabilities for the base org caps. Two hooks because the
 * Capability unions are distinct: the base capabilities.ts canon is the
 * org-level constitutional one; this side-car carries Wave 2 caps.
 */
export interface VioCapabilitiesApi {
  role: RoleCode | null;
  can: (cap: VendorsInventoryOpsCapability) => boolean;
}

export function useVioCapabilities(): VioCapabilitiesApi {
  const auth = useAuthOptional();
  const enabled = auth ? auth.state.status === 'authenticated' : undefined;
  const me = useMe(enabled === undefined ? {} : { enabled });
  const role: RoleCode | null = (me.data?.active_role as RoleCode | undefined) ?? null;

  return useMemo(
    () => ({
      role,
      can: (cap: VendorsInventoryOpsCapability) =>
        role ? hasVendorsInventoryOpsCap(role, cap) : false,
    }),
    [role],
  );
}
