// PR A3: pure helper for the PaymentCreatePage amount-from-balance
// pre-fill. Extracted from the page component so the vitest unit test
// can pin the contract without rendering React or loading the supabase
// client at module-graph time (matches the pattern used by
// applyItemSelection.ts and formatQuoteStateLabel.ts).
//
// `balance_cents` arrives as either an integer or a numeric string
// (FinanceCentsSchema is z.union<int, string-of-digits>). Coerce both
// shapes to an integer cents value. Return `null` to signal "do not
// pre-fill" — the caller leaves the field at its current value.

export type BalanceCentsInput = number | string | null | undefined;

export function resolveInvoiceBalancePrefill(
  balance: BalanceCentsInput,
): number | null {
  if (balance === null || balance === undefined) return null;
  const asNumber = typeof balance === 'string' ? Number(balance) : balance;
  if (!Number.isFinite(asNumber)) return null;
  // Zero or negative balance means there is nothing left to collect, so
  // skip the pre-fill — the operator can still type an amount manually
  // (e.g. for an overpayment) without first having to clear "0.00".
  if (asNumber <= 0) return null;
  return asNumber;
}
