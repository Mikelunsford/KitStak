// F-UIUX-TOASTS-ROLLOUT-01: pure next-step message for the PO-created toast.
// Extracted so the wording is unit-testable without sonner or a renderer
// (mirrors quoteCreatedToast.ts).
//
// The next step depends on whether the operator staged line items at create:
// with lines, the PO is ready to send to the vendor; without, the next step is
// adding lines on the detail page. Pattern A: the toast names that next verb.

export function poCreatedMessage(
  poNumber: string | null | undefined,
  lineCount: number,
): string {
  const subject = poNumber ? `PO ${poNumber}` : 'PO';
  if (lineCount > 0) {
    const lines = lineCount === 1 ? '1 line' : `${lineCount} lines`;
    return `${subject} created with ${lines}. Send it to the vendor next.`;
  }
  return `${subject} created. Add line items to build it out.`;
}
