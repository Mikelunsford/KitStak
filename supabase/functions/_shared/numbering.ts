// Document numbering helper.
//
// Single source for per-org per-doc-type sequence allocation. Wraps
// public.next_doc_number(uuid, text) RPC which uses pg_advisory_xact_lock
// (hashtext(org_id::text || ':' || doc_type)) for gap-free allocation under
// concurrent load. The RPC is SECURITY DEFINER and reads from
// public.numbering_sequences.
//
// Format and reset policy are owned by the DB (per-org per-doc-type rows
// carry prefix, pad_width, reset_period). The application never touches the
// row directly; it asks for the next number and gets a formatted string back.
//
// Phase 1 establishes the surface; finance/sales bundles in later waves will
// be the first callers.

import { admin } from './handler-helpers.ts';
import { ApiError } from './responses.ts';

export type DocType =
  | 'quote'
  | 'invoice'
  | 'credit_note'
  | 'payment'
  | 'project'
  | 'purchase_order'
  | 'vendor_bill'
  | 'expense'
  | 'journal_entry'
  | 'receiving_order'
  | 'production_run'
  | 'shipment';

/**
 * Allocate the next document number for (org, docType). Returns the
 * formatted string (e.g. `INV2026-000123`).
 *
 * Throws INTERNAL_ERROR on RPC failure or non-string payload. The advisory
 * lock makes the RPC infallible once the per-(org, docType) seed row exists;
 * a thrown error signals either a missing seed row or a real DB failure.
 */
export async function nextDocNumber(
  orgId: string,
  docType: DocType,
): Promise<string> {
  const { data, error } = await admin().rpc('next_doc_number', {
    p_org_id: orgId,
    p_doc_type: docType,
  });
  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `next_doc_number(${docType}) failed: ${error.message}`,
      { detail: error.message, doc_type: docType },
    );
  }
  if (typeof data !== 'string' || data.length === 0) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `next_doc_number(${docType}) returned non-string payload`,
      { doc_type: docType },
    );
  }
  return data;
}
