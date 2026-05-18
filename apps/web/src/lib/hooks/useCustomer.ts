import { useQuery } from '@tanstack/react-query';

import { customersKeys } from '@/lib/queryKeys/customers';
import { getCustomer } from '@/lib/services/customersService';

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: id ? customersKeys.detail(id) : ['crm', 'customers', 'detail', 'noop'],
    queryFn: () => getCustomer(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}
