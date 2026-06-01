import { useQuery } from '@tanstack/react-query';

import { leadsKeys } from '@/lib/queryKeys/leads';
import { getLead } from '@/lib/services/leadsService';

export function useLead(id: string | undefined) {
  return useQuery({
    queryKey: id ? leadsKeys.detail(id) : ['crm', 'leads', 'detail', 'noop'],
    queryFn: () => getLead(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}
