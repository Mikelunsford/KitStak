/**
 * Journal entry query keys.
 */

import type { ListJournalEntriesFilters } from '@/lib/services/journalEntriesService';

export const journalEntryKeys = {
  all: ['finance', 'journal-entries'] as const,
  list: (filters: ListJournalEntriesFilters = {}) =>
    ['finance', 'journal-entries', 'list', filters] as const,
  detail: (id: string) => ['finance', 'journal-entries', 'detail', id] as const,
};
