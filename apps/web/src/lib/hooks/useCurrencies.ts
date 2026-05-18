import { useQuery } from '@tanstack/react-query';

import { currenciesKeys } from '@/lib/queryKeys/currencies';
import { listCurrencies } from '@/lib/services/currenciesService';

export function useCurrenciesList() {
  return useQuery({
    queryKey: currenciesKeys.list(),
    queryFn: () => listCurrencies(),
    staleTime: 5 * 60_000,
  });
}
