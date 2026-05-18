import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { creditNoteKeys } from '@/lib/queryKeys/creditNotes';
import { invoiceKeys } from '@/lib/queryKeys/invoices';
import {
  applyCreditNote,
  createCreditNote,
  deleteCreditNote,
  getCreditNote,
  listCreditNotes,
  updateCreditNote,
  type CreditNoteApplyBody,
  type CreditNoteCreate,
  type CreditNotePatch,
  type ListCreditNotesFilters,
} from '@/lib/services/creditNotesService';

export function useCreditNotes(filters: ListCreditNotesFilters = {}) {
  return useQuery({
    queryKey: creditNoteKeys.list(filters),
    queryFn: () => listCreditNotes(filters),
    staleTime: 30_000,
  });
}

export function useCreditNote(id: string) {
  return useQuery({
    queryKey: creditNoteKeys.detail(id),
    queryFn: () => getCreditNote(id),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreditNoteCreate) => createCreditNote(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: creditNoteKeys.all }),
  });
}

export function useUpdateCreditNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreditNotePatch) => updateCreditNote(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: creditNoteKeys.detail(id) });
      qc.invalidateQueries({ queryKey: creditNoteKeys.all });
    },
  });
}

export function useDeleteCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCreditNote(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: creditNoteKeys.all }),
  });
}

export function useApplyCreditNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreditNoteApplyBody }) =>
      applyCreditNote(id, body),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: creditNoteKeys.detail(id) });
      qc.invalidateQueries({ queryKey: creditNoteKeys.all });
      qc.invalidateQueries({ queryKey: invoiceKeys.all });
    },
  });
}
