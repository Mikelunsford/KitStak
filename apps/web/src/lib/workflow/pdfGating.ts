// F-Wave9-AUDIT-V3-WAVE-E-01 (item 4): pure predicate for the
// "Download PDF" / "Send PDF" buttons. A draft is operator-only and
// not customer-visible yet — sending a draft PDF to a customer is a
// trust hazard. The button stays present (so the operator can see
// the action exists once the entity is sent) but disabled, with a
// tooltip explaining why.
//
// Storage / FSM unchanged. This is a button-state predicate only.

/**
 * Returns true when the entity is in a draft-equivalent state and
 * the PDF action should be disabled.
 *
 * Invoice draft state values: `'draft'`.
 * Quote draft state values: `'draft'`, `'revise_requested'` — both
 * are pre-customer states the operator is still working in.
 */
export function isPdfDisabledForDraft(
  state: string | null | undefined,
): boolean {
  if (!state) return false;
  return state === 'draft' || state === 'revise_requested';
}

/**
 * Tooltip copy shown when the button is disabled. Stays short and
 * action-oriented per the constitution's no-emojis / no-em-dash rule.
 */
export const PDF_DRAFT_DISABLED_TOOLTIP =
  'Send or approve this document before generating a PDF.';
