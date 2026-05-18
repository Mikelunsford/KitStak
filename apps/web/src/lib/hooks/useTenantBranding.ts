import { useQuery } from '@tanstack/react-query';

import { tenantsKeys } from '@/lib/queryKeys/tenants';
import { getTenantBranding } from '@/lib/services/tenantsService';

/**
 * Active-org branding row. Long stale window since branding changes are
 * admin-driven, not per-render. The shell BrandingProvider already wires
 * its own copy of this query against the legacy `brandingService`; this
 * hook is the Wave 2 replacement that hits tenants-api/branding directly.
 */
export function useTenantBranding(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: tenantsKeys.branding,
    queryFn: getTenantBranding,
    staleTime: 5 * 60_000,
    enabled: opts.enabled ?? false,
  });
}
