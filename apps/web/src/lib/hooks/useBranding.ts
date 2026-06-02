import { useQuery } from '@tanstack/react-query';

import { brandingKeys } from '@/lib/queryKeys/branding';
import { getBranding } from '@/lib/services/brandingService';
import { QUERY_DEFAULTS } from './queryDefaults';

/**
 * React Query hook for the active org's branding row.
 *
 * Wave 1: the tenants-api edge function ships in Wave 2. Default to
 * `enabled: false`; consumers pass `enabled: true` once the session has
 * hydrated. BrandingProvider falls through to platform defaults while
 * `data` is undefined, so the SPA never flashes to white.
 *
 * Stale window is intentionally long (5 minutes). branding changes are
 * an admin-driven action, not per-render.
 */
export function useBranding(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: brandingKeys.all,
    queryFn: getBranding,
    ...QUERY_DEFAULTS,
    staleTime: 5 * 60_000,
    enabled: opts.enabled ?? false,
  });
}
