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

/** GET /settings-api/flags. */
export function useFlags(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: flagsKeys.list,
    queryFn: listFeatureFlags,
    staleTime: 30_000,
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
