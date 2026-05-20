// useVioCapabilities was a Wave 2 side-car hook keyed to
// VendorsInventoryOpsCapability. At F-Wave2-AGENT-A-05 the side-car cap
// canon was folded into the singular `@/lib/capabilities` union. This file
// is now a thin re-export so the 14 page-level callers do not need to
// change; they continue to pass cap strings and get a memoised `can`.

import { useMemo } from 'react';

import { useAuthOptional } from '@/auth/AuthContext';
import {
  hasCap,
  type Capability,
  type RoleCode,
} from '@/lib/capabilities';
import { useMe } from './useMe';

/**
 * Backwards-compatible alias for the vendors / inventory / ops side-car
 * cap union. Now points at the unified Capability type so any cap the
 * unified canon carries works.
 */
export type VendorsInventoryOpsCapability = Capability;

export interface VioCapabilitiesApi {
  role: RoleCode | null;
  can: (cap: Capability) => boolean;
}

export function useVioCapabilities(): VioCapabilitiesApi {
  const auth = useAuthOptional();
  const enabled = auth ? auth.state.status === 'authenticated' : undefined;
  const me = useMe(enabled === undefined ? {} : { enabled });
  const role: RoleCode | null = (me.data?.active_role as RoleCode | undefined) ?? null;

  return useMemo(
    () => ({
      role,
      can: (cap: Capability) => (role ? hasCap(role, cap) : false),
    }),
    [role],
  );
}
