import { useQuery } from '@tanstack/react-query';

import { leadsKeys } from '@/lib/queryKeys/leads';
import { listLeads, type ListLeadsFilters } from '@/lib/services/leadsService';
import { QUERY_DEFAULTS } from './queryDefaults';

export function useLeads(filters: ListLeadsFilters = {}) {
  return useQuery({
    queryKey: leadsKeys.list(filters as Record<string, unknown>),
    queryFn: () => listLeads(filters),
    ...QUERY_DEFAULTS,
  });
}
