// BNEW-10: pure cache-key helper used by useApplyPayment's onSuccess.
//
// Pulled into its own file so the regression test can import it
// without transitively loading `@/lib/services/paymentsService` (which
// pulls `@/lib/apiClient`, which pulls the SPA supabase singleton; the
// singleton throws at import time when VITE_ env vars are absent — the
// vitest unit environment is exactly that case).
//
// The exported function returns the full list of TanStack query keys
// that must be marked stale after a payment is allocated to one or
// more invoices. The invoice detail page's PAYMENTS section subscribes
// to a customer-scoped payments list; without bumping the payment tree
// AND the invoice tree AND the per-invoice payment key, that page
// briefly renders "No payments received from this customer yet." after
// the operator receives + applies the first payment (the BNEW-10
// symptom from the 2026-05-22 v2 smoke walk).

import { paymentKeys } from '@/lib/queryKeys/payments';
import { invoiceKeys } from '@/lib/queryKeys/invoices';
import type { PaymentApplyBody } from '@/lib/services/paymentsService';

export function applyPaymentInvalidationKeys(
  paymentId: string,
  body: PaymentApplyBody,
): ReadonlyArray<ReadonlyArray<unknown>> {
  const keys: Array<ReadonlyArray<unknown>> = [
    paymentKeys.detail(paymentId),
    paymentKeys.all,
    invoiceKeys.all,
  ];
  for (const alloc of body.allocations ?? []) {
    if (alloc.invoice_id) {
      keys.push(paymentKeys.byInvoice(alloc.invoice_id));
    }
  }
  return keys;
}
