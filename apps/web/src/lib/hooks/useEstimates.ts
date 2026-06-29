import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { estimatesKeys } from '@/lib/queryKeys/estimates';
import {
  listEstimates,
  getEstimate,
  createEstimate,
  updateEstimate,
  convertEstimate,
  cancelEstimate,
} from '@/lib/services/estimatesService';
import type {
  CreateEstimateRequest,
  UpdateEstimateRequest,
  ConvertEstimateRequest,
} from '@/lib/types/estimate';

export function useEstimatesList() {
  return useQuery({
    queryKey: estimatesKeys.list(),
    queryFn: () => listEstimates(),
  });
}

export function useEstimate(id: string | undefined) {
  return useQuery({
    queryKey: estimatesKeys.byId(id ?? ''),
    queryFn: () => getEstimate(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateEstimateRequest) => createEstimate(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: estimatesKeys.all });
    },
  });
}

export function useUpdateEstimate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateEstimateRequest) => updateEstimate(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: estimatesKeys.all });
    },
  });
}

export function useConvertEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; payload?: ConvertEstimateRequest }) =>
      convertEstimate(vars.id, vars.payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: estimatesKeys.all });
    },
  });
}

export function useCancelEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelEstimate(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: estimatesKeys.all });
    },
  });
}
