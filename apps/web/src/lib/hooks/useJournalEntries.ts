import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { journalEntryKeys } from '@/lib/queryKeys/journalEntries';
import {
  createJournalEntry,
  deleteJournalEntry,
  getJournalEntry,
  listJournalEntries,
  postJournalEntry,
  updateJournalEntry,
  type JournalEntryCreate,
  type JournalEntryPatch,
  type ListJournalEntriesFilters,
} from '@/lib/services/journalEntriesService';

export function useJournalEntries(filters: ListJournalEntriesFilters = {}) {
  return useQuery({
    queryKey: journalEntryKeys.list(filters),
    queryFn: () => listJournalEntries(filters),
    staleTime: 30_000,
  });
}

export function useJournalEntry(id: string) {
  return useQuery({
    queryKey: journalEntryKeys.detail(id),
    queryFn: () => getJournalEntry(id),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: JournalEntryCreate) => createJournalEntry(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: journalEntryKeys.all }),
  });
}

export function useUpdateJournalEntry(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: JournalEntryPatch) => updateJournalEntry(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: journalEntryKeys.detail(id) });
      qc.invalidateQueries({ queryKey: journalEntryKeys.all });
    },
  });
}

export function useDeleteJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJournalEntry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: journalEntryKeys.all }),
  });
}

export function usePostJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postJournalEntry(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: journalEntryKeys.detail(id) });
      qc.invalidateQueries({ queryKey: journalEntryKeys.all });
    },
  });
}
