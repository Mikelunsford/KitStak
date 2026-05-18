import { useQuery } from '@tanstack/react-query';

import { customersKeys } from '@/lib/queryKeys/customers';
import {
  listCustomers,
  type ListCustomersFilters,
} from '@/lib/services/customersService';

export function useCustomers(filters: ListCustomersFilters = {}) {
  return useQuery({
    queryKey: customersKeys.list(filters as Record<string, unknown>),
    queryFn: () => listCustomers(filters),
    staleTime: 30_000,
  });
}
