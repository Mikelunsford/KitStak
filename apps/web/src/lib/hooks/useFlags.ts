import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { flagsKeys } from '@/lib/queryKeys/flags';
import {
  listFeatureFlags,
  upsertFeatureFlag,
  type FlagUpsertInput,
} from '@/lib/services/flagsService';

/**
 * GET /settings-api/flags.
 *
 * BNEW-11: feature flag freshness. The 2026-05-22 v2 smoke walk saw the
 * Manufacturing runs sidebar entry render against an org whose DB row had
 * `plugins.manufacturing = false`. Root cause was a stale TanStack Query
 * cache: the prior session had cached `is_enabled = true`, the operator
 * (or admin tooling) flipped the flag off between sessions, and without
 * refetch triggers the SPA served the stale value for the whole tab
 * lifetime. The edge function read fresh and 404'd the POST, diverging
 * the SPA's view from the live gate.
 *
 * Adding `refetchOnWindowFocus: true` and `refetchOnMount: 'always'`
 * means flag drift heals within one window-focus or navigation event
 * without changing the chassis defaults for other queries. `staleTime`
 * stays at 30s so a quick re-mount inside the same window doesn't refire
 * the request.
 */
export function useFlags(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: flagsKeys.list,
    queryFn: listFeatureFlags,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    enabled: opts.enabled ?? false,
  });
}

/** PUT /settings-api/flags/:flag_key. */
export function useUpsertFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: FlagUpsertInput) => upsertFeatureFlag(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: flagsKeys.all });
    },
  });
}
