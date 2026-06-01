import { useQuery } from '@tanstack/react-query';

import { opportunitiesKeys } from '@/lib/queryKeys/opportunities';
import { getOpportunity } from '@/lib/services/opportunitiesService';

export function useOpportunity(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? opportunitiesKeys.detail(id)
      : ['crm', 'opportunities', 'detail', 'noop'],
    queryFn: () => getOpportunity(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}
