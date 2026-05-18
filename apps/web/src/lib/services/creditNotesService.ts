/**
 * Credit notes service. Wraps invoicing-api/credit-notes.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import {
  CreditNoteAllocationSchema,
  CreditNoteSchema,
  type CreditNote,
  type CreditNoteAllocation,
} from '@/lib/types/finance';

const CreditNoteListSchema = z.array(CreditNoteSchema);
const CnAllocListSchema = z.array(CreditNoteAllocationSchema);

export type CreditNoteCreate = {
  credit_note_number: string;
  customer_id?: string;
  source_invoice_id?: string;
  currency_code?: string;
  amount_cents: number | string;
  reason?: string;
};

export type CreditNotePatch = Partial<CreditNoteCreate>;

export type CreditNoteApplyBody = {
  allocations: Array<{ invoice_id: string; amount_cents: number | string }>;
};

export type ListCreditNotesFilters = {
  status?: string;
  cursor?: string;
  limit?: number;
};

function qs(f: ListCreditNotesFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.cursor) p.set('cursor', f.cursor);
  if (f.limit !== undefined) p.set('limit', String(f.limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listCreditNotes(
  filters: ListCreditNotesFilters = {},
): Promise<CreditNote[]> {
  const data = await apiRequest<unknown>(`/invoicing-api/credit-notes${qs(filters)}`, {
    method: 'GET',
  });
  return CreditNoteListSchema.parse(data);
}

export async function getCreditNote(id: string): Promise<CreditNote> {
  const data = await apiRequest<unknown>(`/invoicing-api/credit-notes/${id}`, {
    method: 'GET',
  });
  return CreditNoteSchema.parse(data);
}

export async function createCreditNote(body: CreditNoteCreate): Promise<CreditNote> {
  const data = await apiRequest<unknown>(`/invoicing-api/credit-notes`, {
    method: 'POST',
    body,
  });
  return CreditNoteSchema.parse(data);
}

export async function updateCreditNote(
  id: string,
  body: CreditNotePatch,
): Promise<CreditNote> {
  const data = await apiRequest<unknown>(`/invoicing-api/credit-notes/${id}`, {
    method: 'PATCH',
    body,
  });
  return CreditNoteSchema.parse(data);
}

export async function deleteCreditNote(id: string): Promise<void> {
  await apiRequest<unknown>(`/invoicing-api/credit-notes/${id}`, { method: 'DELETE' });
}

export async function applyCreditNote(
  id: string,
  body: CreditNoteApplyBody,
): Promise<CreditNoteAllocation[]> {
  const data = await apiRequest<unknown>(`/invoicing-api/credit-notes/${id}/apply`, {
    method: 'POST',
    body,
  });
  return CnAllocListSchema.parse(data);
}
