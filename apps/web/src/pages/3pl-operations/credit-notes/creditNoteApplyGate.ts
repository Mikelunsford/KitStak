// F-UIUX-CREDIT-NOTE-APPLY-CTA-01: pure gate for surfacing the "Apply to
// invoice" CTA on the credit-note detail page. The apply route already exists
// (/invoicing/credit-notes/:id/apply); this decides when the detail page should
// offer it. Extracted as a pure helper so the vitest unit test can pin the
// contract without rendering React (matches resolveInvoiceBalancePrefill.ts).
//
// amount_cents and applied_cents arrive as an integer or a numeric string
// (FinanceCentsSchema). A credit note has balance left to apply only once it
// has been issued and amount minus applied is positive. The server stays the
// authority (the apply route re-checks status and balance); this is a pure SPA
// render gate, paired with a credit_notes.apply capability check at the call
// site.

export type CreditNoteCents = number | string | null | undefined;

function toCents(value: CreditNoteCents): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Remaining cents on a credit note: amount minus already-applied. Both inputs
 * are integer cents (or numeric strings); the result is integer cents.
 */
export function creditNoteRemainingCents(
  amount: CreditNoteCents,
  applied: CreditNoteCents,
): number {
  return toCents(amount) - toCents(applied);
}

/**
 * Whether the detail page should surface the Apply CTA: the note is issued and
 * has a positive remaining balance. Draft, voided, and fully-applied notes do
 * not offer it.
 */
export function canApplyCreditNote(
  status: string,
  amount: CreditNoteCents,
  applied: CreditNoteCents,
): boolean {
  return status === 'issued' && creditNoteRemainingCents(amount, applied) > 0;
}
