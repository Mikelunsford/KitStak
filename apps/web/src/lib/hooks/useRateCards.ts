import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { rateCardsKeys } from '@/lib/queryKeys/rateCards';
import {
  getActiveRateCard,
  addRateCardLine,
  patchRateCardLine,
  deleteRateCardLine,
} from '@/lib/services/rateCardsService';
import type { RateCardLineCreate, RateCardLinePatch } from '@/lib/types/estimate';

export function useActiveRateCard() {
  return useQuery({
    queryKey: rateCardsKeys.active(),
    queryFn: () => getActiveRateCard(),
    staleTime: 30_000,
  });
}

export function useAddRateCardLine(cardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: RateCardLineCreate) => addRateCardLine(cardId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rateCardsKeys.all });
    },
  });
}

export function usePatchRateCardLine(cardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { lineId: string; patch: RateCardLinePatch }) =>
      patchRateCardLine(cardId, vars.lineId, vars.patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rateCardsKeys.all });
    },
  });
}

export function useDeleteRateCardLine(cardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => deleteRateCardLine(cardId, lineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rateCardsKeys.all });
    },
  });
}
