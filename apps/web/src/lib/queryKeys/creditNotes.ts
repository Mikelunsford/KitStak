/**
 * Credit note query keys.
 */

import type { ListCreditNotesFilters } from '@/lib/services/creditNotesService';

export const creditNoteKeys = {
  all: ['invoicing', 'credit-notes'] as const,
  list: (filters: ListCreditNotesFilters = {}) =>
    ['invoicing', 'credit-notes', 'list', filters] as const,
  detail: (id: string) => ['invoicing', 'credit-notes', 'detail', id] as const,
};
