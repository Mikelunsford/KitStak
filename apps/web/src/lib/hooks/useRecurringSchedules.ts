import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { recurringScheduleKeys } from '@/lib/queryKeys/recurringSchedules';
import {
  createRecurringSchedule,
  endRecurringSchedule,
  listRecurringSchedules,
  pauseRecurringSchedule,
  resumeRecurringSchedule,
} from '@/lib/services/recurringSchedulesService';
import type { CreateRecurringScheduleRequest } from '@/lib/types/finance';

export function useRecurringSchedules(projectId: string) {
  return useQuery({
    queryKey: recurringScheduleKeys.byProject(projectId),
    queryFn: () => listRecurringSchedules({ project_id: projectId }),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
}

export function useCreateRecurringSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRecurringScheduleRequest) => createRecurringSchedule(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: recurringScheduleKeys.byProject(projectId) });
    },
  });
}

export function usePauseRecurringSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pauseRecurringSchedule(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: recurringScheduleKeys.byProject(projectId) });
    },
  });
}

export function useResumeRecurringSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resumeRecurringSchedule(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: recurringScheduleKeys.byProject(projectId) });
    },
  });
}

export function useEndRecurringSchedule(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => endRecurringSchedule(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: recurringScheduleKeys.byProject(projectId) });
    },
  });
}
