import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { CustomerPicker, InvoicePicker } from '@/components/ui/pickers';
import { useCreatePayment, useApplyPayment } from '@/lib/hooks/usePayments';

/**
 * PaymentCreatePage. Closes G-PAY-FORM-01 and partially G-PAY-FLOW-01.
 * Pre-fills customer_id and invoice_id from query params so the InvoiceDetail
 * "Receive payment" CTA lands here with context. Allocates the new payment
 * to the selected invoice in a second mutation so the operator does not have
 * to follow the apply step manually.
 */
export function PaymentCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreatePayment();
  const apply = useApplyPayment();

  const prefilledCustomerId = searchParams.get('customer_id');
  const prefilledInvoiceId = searchParams.get('invoice_id');

  const [paymentNumber, setPaymentNumber] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(prefilledCustomerId);
  const [invoiceId, setInvoiceId] = useState<string | null>(prefilledInvoiceId);
  const [amountCents, setAmountCents] = useState('0');
  const [currency, setCurrency] = useState('USD');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');

  // Keep invoice picker scoped to the customer if the user changes the
  // customer post-prefill.
  useEffect(() => {
    if (prefilledCustomerId && !customerId) setCustomerId(prefilledCustomerId);
    if (prefilledInvoiceId && !invoiceId) setInvoiceId(prefilledInvoiceId);
    // We intentionally only sync on mount; subsequent edits flow through
    // the controlled state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body: {
      payment_number: string;
      customer_id?: string;
      amount_cents: string;
      currency_code: string;
      payment_method?: string;
      reference_number?: string;
      received_at?: string;
      notes?: string;
    } = {
      payment_number: paymentNumber,
      amount_cents: amountCents,
      currency_code: currency,
    };
    if (customerId) body.customer_id = customerId;
    if (paymentMethod) body.payment_method = paymentMethod;
    if (referenceNumber) body.reference_number = referenceNumber;
    if (receivedAt) body.received_at = receivedAt;
    if (notes) body.notes = notes;

    const payment = await create.mutateAsync(body);

    if (invoiceId) {
      await apply.mutateAsync({
        id: payment.id,
        body: {
          allocations: [{ invoice_id: invoiceId, amount_cents: amountCents }],
        },
      });
      navigate(`/invoicing/invoices/${invoiceId}`);
    } else {
      navigate(`/invoicing/payments`);
    }
  };

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">RECEIVE PAYMENT</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Payment number"
          value={paymentNumber}
          onChange={(e) => setPaymentNumber(e.target.value)}
          required
        />
        <CustomerPicker
          value={customerId}
          onChange={(v) => {
            setCustomerId(v);
            // Clear invoice if customer changes
            if (v !== customerId) setInvoiceId(null);
          }}
          label="Customer"
          required
        />
        <InvoicePicker
          value={invoiceId}
          onChange={setInvoiceId}
          label="Invoice (optional, allocates on save)"
          filter={customerId ? { customer_id: customerId } : undefined}
        />
        <TextInput
          label="Amount (cents)"
          value={amountCents}
          onChange={(e) => setAmountCents(e.target.value)}
          inputMode="numeric"
          required
        />
        <TextInput
          label="Currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          maxLength={3}
        />
        <TextInput
          label="Payment method"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          placeholder="ach, wire, card, check."
        />
        <TextInput
          label="Received at"
          type="date"
          value={receivedAt}
          onChange={(e) => setReceivedAt(e.target.value)}
        />
        <TextInput
          label="Reference number"
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        {(create.error || apply.error) && (
          <p className="text-accent font-sans text-sm">
            {((create.error ?? apply.error) as Error).message}
          </p>
        )}

        <Button type="submit" disabled={create.isPending || apply.isPending}>
          {create.isPending || apply.isPending ? 'Saving.' : 'Save payment'}
        </Button>
      </form>
    </section>
  );
}
