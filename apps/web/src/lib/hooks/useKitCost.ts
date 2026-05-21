// KitCost TanStack Query hooks. Path C / C2.
//
// One read-only query. Cap-gated client-side via useCapabilities; the server
// independently 403s the request if a determined caller bypasses the SPA gate.

import { useQuery } from '@tanstack/react-query';

import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { fetchKitCostSummary } from '@/lib/services/kitcostService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

export const kitcostKeys = {
  all: ['kitcost'] as const,
  summary: () => ['kitcost', 'summary'] as const,
};

export function useKitCostSummary() {
  const caps = useCapabilities();
  const enabled = caps.can('kitcost.dashboard.view');
  return useQuery({
    queryKey: kitcostKeys.summary(),
    queryFn: fetchKitCostSummary,
    enabled,
    ...C,
  });
}
