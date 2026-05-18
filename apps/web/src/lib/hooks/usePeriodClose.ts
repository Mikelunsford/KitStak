import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { periodCloseKeys } from '@/lib/queryKeys/periodClose';
import { journalEntryKeys } from '@/lib/queryKeys/journalEntries';
import {
  closePeriod,
  listPeriodClose,
  reopenPeriod,
  type PeriodInput,
} from '@/lib/services/periodCloseService';

export function usePeriodClose(opts: { year?: number } = {}) {
  return useQuery({
    queryKey: periodCloseKeys.list(opts),
    queryFn: () => listPeriodClose(opts),
    staleTime: 30_000,
  });
}

export function useClosePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PeriodInput) => closePeriod(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: periodCloseKeys.all });
      qc.invalidateQueries({ queryKey: journalEntryKeys.all });
    },
  });
}

export function useReopenPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PeriodInput) => reopenPeriod(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: periodCloseKeys.all });
      qc.invalidateQueries({ queryKey: journalEntryKeys.all });
    },
  });
}
