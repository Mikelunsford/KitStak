// F-Wave9-AUDIT-V3-WAVE-F-01: inline Receive Payment modal.
//
// Previously the "Receive payment" CTA on InvoiceDetailPage navigated to
// `/3pl-operations/payments/new?invoice_id=...` and the operator was
// dropped onto the full PaymentCreatePage. This modal keeps the operator
// on the invoice detail page: it pre-fills invoice_id, amount (the
// invoice's outstanding balance via PR #131's resolveInvoiceBalancePrefill),
// and received_at (today via PR #127's todayIsoDate). Submit posts to
// /invoicing-api/payments + applies the allocation, then closes and
// refreshes the invoice's payments list (the existing useCreatePayment
// + useApplyPayment hooks already invalidate the invoice tree).
//
// Brand posture:
//   - Hand-rolled `<div role="dialog">` with a backdrop. No modal library.
//   - Tailwind utilities only. Brand tokens (`bg-bg-1`, `border-line`,
//     etc.) come from the existing palette.
//   - No new top-level deps; reuses Button / TextInput / DollarInput.

import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { DollarInput } from '@/components/forms/DollarInput';
import { useCreatePayment, useApplyPayment } from '@/lib/hooks/usePayments';

import {
  buildReceivePaymentDefaults,
  buildReceivePaymentPostBodies,
} from './receivePaymentPrefill';

export interface ReceivePaymentModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Invoice context. The modal pre-fills the amount from `balanceCents`
   * and posts an allocation against `invoiceId`. `customerId` is sent
   * on the payment header so a future unapplied allocation against
   * other invoices keeps the customer link intact.
   */
  invoiceId: string;
  customerId: string | null;
  balanceCents: number | string | null;
  currencyCode: string;
  /** Optional callback fired after a successful save + apply. */
  onSuccess?: () => void;
}

/**
 * ReceivePaymentModal. Inline create-and-apply payment dialog.
 */
export function ReceivePaymentModal({
  open,
  onClose,
  invoiceId,
  customerId,
  balanceCents,
  currencyCode,
  onSuccess,
}: ReceivePaymentModalProps): JSX.Element | null {
  const create = useCreatePayment();
  const apply = useApplyPayment();

  // Prefill state via the pure helper so the contract is unit-tested.
  // PR #131 (balance) + PR #127 (today) are reused, not reimplemented.
  const initialDefaults = buildReceivePaymentDefaults(balanceCents ?? null);
  const [amountCents, setAmountCents] = useState<number | null>(
    initialDefaults.amountCents,
  );
  const [receivedAt, setReceivedAt] = useState<string>(initialDefaults.receivedAt);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');

  // Re-prefill whenever the modal opens against a new balance. The form
  // keeps any in-progress operator edit when the balance has not changed.
  useEffect(() => {
    if (!open) return;
    const next = buildReceivePaymentDefaults(balanceCents ?? null);
    setAmountCents(next.amountCents);
    setReceivedAt(next.receivedAt);
    setPaymentMethod('');
    setReferenceNumber('');
    create.reset();
    apply.reset();
    // We intentionally do NOT depend on the mutation handles — resetting
    // them is a one-shot side effect of opening, not a reactive read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, balanceCents]);

  if (!open) return null;

  const pending = create.isPending || apply.isPending;
  const errorSource = create.error ?? apply.error;
  const errorMessage = errorSource instanceof Error ? errorSource.message : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const { payment: paymentBody, allocation: allocationBody } =
      buildReceivePaymentPostBodies(
        { amountCents, receivedAt, paymentMethod, referenceNumber },
        { invoiceId, customerId, currencyCode },
      );
    try {
      const payment = await create.mutateAsync(paymentBody);
      await apply.mutateAsync({ id: payment.id, body: allocationBody });
      if (onSuccess) onSuccess();
      onClose();
    } catch {
      // Errors surface via the inline banner below.
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receive-payment-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      {/* Backdrop. Clicking dismisses the modal so the operator can
          escape without committing. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 cursor-default"
      />
      <div className="relative bg-bg-1 border border-line w-full max-w-md mx-4 p-6 flex flex-col gap-4">
        <h2
          id="receive-payment-modal-title"
          className="text-2xl font-display tracking-wide text-ink"
        >
          RECEIVE PAYMENT
        </h2>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DollarInput
            label="Amount"
            name="amount_cents"
            value={amountCents}
            onChange={setAmountCents}
            required
          />
          <TextInput
            label="Received at"
            type="date"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
          />
          <TextInput
            label="Payment method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            placeholder="ach, wire, card, check"
          />
          <TextInput
            label="Reference number"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
          />

          {errorMessage && (
            <p className="text-accent font-sans text-sm">{errorMessage}</p>
          )}

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving.' : 'Save payment'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
