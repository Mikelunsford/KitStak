/**
 * Credit note allocations service. Thin module that mirrors the apply
 * endpoint helpers so hooks can import from a dedicated module path.
 */

import { CreditNoteAllocationSchema, type CreditNoteAllocation } from '@/lib/types/finance';
import {
  applyCreditNote,
  type CreditNoteApplyBody,
} from '@/lib/services/creditNotesService';

export type { CreditNoteApplyBody } from '@/lib/services/creditNotesService';

export async function applyCreditNoteAllocations(
  creditNoteId: string,
  body: CreditNoteApplyBody,
): Promise<CreditNoteAllocation[]> {
  return applyCreditNote(creditNoteId, body);
}

export { CreditNoteAllocationSchema };
