// F-UIUX-TOASTS-ROLLOUT-01: pure next-step message for the invoice-created
// toast. Extracted so the wording is unit-testable without sonner or a renderer
// (mirrors quoteCreatedToast.ts).
//
// The next step depends on whether the operator staged or derived line items at
// create: with lines, the invoice is ready to issue and send; without, the next
// step is adding lines on the detail page. Pattern A: the toast names that next
// verb.

export function invoiceCreatedMessage(
  invoiceNumber: string | null | undefined,
  lineCount: number,
): string {
  const subject = invoiceNumber ? `Invoice ${invoiceNumber}` : 'Invoice';
  if (lineCount > 0) {
    const lines = lineCount === 1 ? '1 line' : `${lineCount} lines`;
    return `${subject} created with ${lines}. Issue and send it next.`;
  }
  return `${subject} created. Add line items to build it out.`;
}
