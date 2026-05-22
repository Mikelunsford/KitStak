// BNEW-10: regression tests for the apply-payment invalidation key
// list. The 2026-05-22 v2 smoke walk caught a race where the invoice
// detail page briefly rendered "No payments received from this
// customer yet." right after the operator saved a $2,500 payment,
// even though the invoice header had already flipped to
// PARTIALLY_PAID. Root cause: useApplyPayment's onSuccess only bumped
// `paymentKeys.detail`, `paymentKeys.all`, and `invoiceKeys.all`. The
// per-invoice list was served from stale cache on the next mount
// because the customer-scoped list query had `staleTime: 30_000`.
//
// This test locks the contract that the helper returns the four cache
// keys we need to mark stale on apply, including the new
// `paymentKeys.byInvoice(invoice_id)` entry for every allocation.

import { describe, it, expect } from 'vitest';

import { applyPaymentInvalidationKeys } from './paymentInvalidation';
import { paymentKeys } from '@/lib/queryKeys/payments';
import { invoiceKeys } from '@/lib/queryKeys/invoices';

const PAYMENT_ID = 'pmt-00000000-0000-4000-8000-000000000001';
const INVOICE_ID = 'inv-00000000-0000-4000-8000-000000000001';
const INVOICE_ID_2 = 'inv-00000000-0000-4000-8000-000000000002';

// Local helper: deep-compare a ReadonlyArray<unknown> "key" to another
// for the expect().toEqual check the matrix below relies on.
function asMutable(key: ReadonlyArray<unknown>): unknown[] {
  return key as unknown as unknown[];
}

describe('applyPaymentInvalidationKeys', () => {
  it('always invalidates payment detail, payment tree, and invoice tree', () => {
    const keys = applyPaymentInvalidationKeys(PAYMENT_ID, {
      allocations: [],
    });
    const flat = keys.map(asMutable);
    expect(flat).toEqual(
      expect.arrayContaining([
        asMutable(paymentKeys.detail(PAYMENT_ID)),
        asMutable(paymentKeys.all),
        asMutable(invoiceKeys.all),
      ]),
    );
  });

  it('also invalidates paymentKeys.byInvoice(invoice_id) for every allocation', () => {
    const keys = applyPaymentInvalidationKeys(PAYMENT_ID, {
      allocations: [{ invoice_id: INVOICE_ID, amount_cents: 250000 }],
    });
    const flat = keys.map(asMutable);
    expect(flat).toContainEqual(asMutable(paymentKeys.byInvoice(INVOICE_ID)));
  });

  it('emits one byInvoice key per distinct invoice allocation', () => {
    const keys = applyPaymentInvalidationKeys(PAYMENT_ID, {
      allocations: [
        { invoice_id: INVOICE_ID, amount_cents: 100000 },
        { invoice_id: INVOICE_ID_2, amount_cents: 50000 },
      ],
    });
    const flat = keys.map(asMutable);
    expect(flat).toContainEqual(asMutable(paymentKeys.byInvoice(INVOICE_ID)));
    expect(flat).toContainEqual(asMutable(paymentKeys.byInvoice(INVOICE_ID_2)));
  });

  it('does not emit a byInvoice key for an empty allocation list', () => {
    const keys = applyPaymentInvalidationKeys(PAYMENT_ID, {
      allocations: [],
    });
    // Only the three baseline keys should be present.
    expect(keys.length).toBe(3);
  });

  it('returns deterministic keys (no spurious entries)', () => {
    const keys = applyPaymentInvalidationKeys(PAYMENT_ID, {
      allocations: [{ invoice_id: INVOICE_ID, amount_cents: 250000 }],
    });
    expect(keys.length).toBe(4);
  });
});
