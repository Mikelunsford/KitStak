import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
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
      // F-Wave7-AUDIT-CACHE-SWEEP-01: JE updates write an audit_log row;
      // invalidate the timeline so the operator returning to the detail
      // page sees the new entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('journal_entry', id) });
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
      // F-Wave7-AUDIT-CACHE-SWEEP-01: JE post drives a draft -> posted
      // transition that writes an audit row; invalidate the timeline so
      // the operator sees the new entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('journal_entry', id) });
    },
  });
}
