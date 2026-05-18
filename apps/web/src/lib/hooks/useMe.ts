import { useQuery } from '@tanstack/react-query';

import { meKeys } from '@/lib/queryKeys/me';
import { getMe } from '@/lib/services/meService';

/**
 * React Query hook for the caller's `/auth-api/me` payload.
 *
 * Wave 1: the auth-api edge function ships in Wave 2. Callers default to
 * `enabled: false` until the endpoint is live (passing `enabled: true`
 * once the session has hydrated). The hook shape and key are stable so
 * downstream code (AuthContext consumers, useCapabilities, Topbar) needs
 * no churn when the endpoint lands.
 */
export function useMe(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: meKeys.all,
    queryFn: getMe,
    staleTime: 60_000,
    enabled: opts.enabled ?? false,
  });
}
