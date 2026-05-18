import { useQuery } from '@tanstack/react-query';

import { taxesKeys } from '@/lib/queryKeys/taxes';
import { listTaxes } from '@/lib/services/taxesService';

export function useTaxesList() {
  return useQuery({ queryKey: taxesKeys.list(), queryFn: () => listTaxes() });
}
