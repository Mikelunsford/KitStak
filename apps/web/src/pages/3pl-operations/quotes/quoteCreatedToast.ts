// F-UIUX-TOASTS-01: pure next-step message for the quote-created toast.
// Extracted so the wording is unit-testable without sonner or a renderer
// (matches the resolveInvoiceBalancePrefill / createMenuActions precedent).
//
// The next step depends on whether the operator staged line items inline at
// create: with lines, the quote is ready to send for approval; without, the
// next step is adding lines. Pattern A: the toast names that next verb.

export function quoteCreatedMessage(
  number: string | null | undefined,
  lineCount: number,
): string {
  const subject = number ? `Quote ${number}` : 'Quote';
  if (lineCount > 0) {
    const lines = lineCount === 1 ? '1 line' : `${lineCount} lines`;
    return `${subject} created with ${lines}. Send it for approval next.`;
  }
  return `${subject} created. Add line items to build it out.`;
}
