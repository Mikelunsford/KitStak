import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { chartOfAccountKeys } from '@/lib/queryKeys/chartOfAccounts';
import {
  createChartOfAccount,
  deleteChartOfAccount,
  getChartOfAccount,
  listChartOfAccounts,
  updateChartOfAccount,
  type CoaCreate,
  type CoaPatch,
} from '@/lib/services/chartOfAccountsService';

export function useChartOfAccounts() {
  return useQuery({
    queryKey: chartOfAccountKeys.list(),
    queryFn: () => listChartOfAccounts(),
    staleTime: 30_000,
  });
}

export function useChartOfAccount(id: string) {
  return useQuery({
    queryKey: chartOfAccountKeys.detail(id),
    queryFn: () => getChartOfAccount(id),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateChartOfAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CoaCreate) => createChartOfAccount(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: chartOfAccountKeys.all }),
  });
}

export function useUpdateChartOfAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CoaPatch) => updateChartOfAccount(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chartOfAccountKeys.detail(id) });
      qc.invalidateQueries({ queryKey: chartOfAccountKeys.all });
    },
  });
}

export function useDeleteChartOfAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteChartOfAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: chartOfAccountKeys.all }),
  });
}
