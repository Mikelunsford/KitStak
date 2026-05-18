/**
 * Journal entries service. Wraps finance-api/journal-entries.
 * Per-route flag finance.journal_entries.enabled is server-enforced; the SPA
 * surfaces 403 FEATURE_DISABLED responses by routing to /feature-unavailable.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import {
  JournalEntryLineSchema,
  JournalEntrySchema,
  JournalEntrySourceTypeSchema,
  type JournalEntry,
  type JournalEntryLine,
} from '@/lib/types/finance';

const JeListSchema = z.array(JournalEntrySchema);
const JeDetailSchema = z.object({
  entry: JournalEntrySchema,
  lines: z.array(JournalEntryLineSchema),
});

export type JournalEntryLineInput = {
  account_id: string;
  debit_cents?: number | string;
  credit_cents?: number | string;
  memo?: string;
  sort_order?: number;
};

export type JournalEntryCreate = {
  entry_number: string;
  entry_date: string;
  period_year: number;
  period_month: number;
  source_type?: z.infer<typeof JournalEntrySourceTypeSchema>;
  source_id?: string;
  memo?: string;
  lines: JournalEntryLineInput[];
};

export type JournalEntryPatch = {
  entry_number?: string;
  entry_date?: string;
  memo?: string;
};

export type ListJournalEntriesFilters = {
  status?: string;
  cursor?: string;
  limit?: number;
};

function qs(f: ListJournalEntriesFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.cursor) p.set('cursor', f.cursor);
  if (f.limit !== undefined) p.set('limit', String(f.limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listJournalEntries(
  filters: ListJournalEntriesFilters = {},
): Promise<JournalEntry[]> {
  const data = await apiRequest<unknown>(`/finance-api/journal-entries${qs(filters)}`, {
    method: 'GET',
  });
  return JeListSchema.parse(data);
}

export type JournalEntryDetail = {
  entry: JournalEntry;
  lines: JournalEntryLine[];
};

export async function getJournalEntry(id: string): Promise<JournalEntryDetail> {
  const data = await apiRequest<unknown>(`/finance-api/journal-entries/${id}`, {
    method: 'GET',
  });
  return JeDetailSchema.parse(data);
}

export async function createJournalEntry(body: JournalEntryCreate): Promise<JournalEntry> {
  const data = await apiRequest<unknown>(`/finance-api/journal-entries`, {
    method: 'POST',
    body,
  });
  return JournalEntrySchema.parse(data);
}

export async function updateJournalEntry(
  id: string,
  body: JournalEntryPatch,
): Promise<JournalEntry> {
  const data = await apiRequest<unknown>(`/finance-api/journal-entries/${id}`, {
    method: 'PATCH',
    body,
  });
  return JournalEntrySchema.parse(data);
}

export async function deleteJournalEntry(id: string): Promise<void> {
  await apiRequest<unknown>(`/finance-api/journal-entries/${id}`, { method: 'DELETE' });
}

export async function postJournalEntry(id: string): Promise<JournalEntry> {
  const data = await apiRequest<unknown>(`/finance-api/journal-entries/${id}/post`, {
    method: 'POST',
    body: {},
  });
  return JournalEntrySchema.parse(data);
}
