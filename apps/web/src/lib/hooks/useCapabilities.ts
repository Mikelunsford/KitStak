import { useMemo } from 'react';

import { useAuthOptional } from '@/auth/AuthContext';
import {
  CAPABILITIES_BY_ROLE,
  hasCap,
  type Capability,
  type RoleCode,
} from '@/lib/capabilities';
import { useMe } from './useMe';

/**
 * Hook returning a memoized `can(cap)` predicate for the active role.
 * Backed by `useMe()`; falls back to deny-all when role is unknown.
 *
 * Why optional auth: in unit tests the hook may render without an
 * AuthProvider in the tree (tests inject role data via React Query
 * mocks). `useAuthOptional` returns undefined in that case and we let
 * the test environment drive useMe directly.
 */
export interface CapabilitiesApi {
  role: RoleCode | null;
  can: (cap: Capability) => boolean;
}

export function useCapabilities(): CapabilitiesApi {
  const auth = useAuthOptional();
  const enabled = auth ? auth.state.status === 'authenticated' : undefined;
  const me = useMe(enabled === undefined ? {} : { enabled });
  const role: RoleCode | null = me.data?.active_role ?? null;

  return useMemo(
    () => ({
      role,
      can: (cap: Capability) => (role ? hasCap(role, cap) : false),
    }),
    [role],
  );
}

export { CAPABILITIES_BY_ROLE };
