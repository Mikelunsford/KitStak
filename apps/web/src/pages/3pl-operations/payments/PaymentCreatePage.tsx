import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { DollarInput } from '@/components/forms/DollarInput';
import { CustomerPicker, InvoicePicker } from '@/components/ui/pickers';
import { useCreatePayment, useApplyPayment } from '@/lib/hooks/usePayments';
import { useInvoice } from '@/lib/hooks/useInvoices';

import { resolveInvoiceBalancePrefill } from './resolveInvoiceBalancePrefill';
import { todayIsoDate } from '@/lib/dates';

/**
 * PaymentCreatePage. Closes G-PAY-FORM-01 and partially G-PAY-FLOW-01.
 * Pre-fills customer_id and invoice_id from query params so the InvoiceDetail
 * "Receive payment" CTA lands here with context. Allocates the new payment
 * to the selected invoice in a second mutation so the operator does not have
 * to follow the apply step manually.
 *
 * PR A3: also pre-fills the Amount field with the invoice's outstanding
 * balance_cents on first load so the most common case ("pay this invoice in
 * full") is a one-click flow. The operator can still type a partial amount
 * over the pre-fill; the prefill effect only fires once per invoice id so
 * a manual edit is never clobbered.
 */
export function PaymentCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreatePayment();
  const apply = useApplyPayment();

  const prefilledCustomerId = searchParams.get('customer_id');
  const prefilledInvoiceId = searchParams.get('invoice_id');

  // B8 completion (v2 smoke 2026-05-22): the invoicing-api handler now
  // allocates PMT-YYYY-NNNNN via the numbering chassis when payment_number
  // is absent, so the SPA no longer asks the operator to type it. Mirrors
  // the standalone invoice create page landed at PR-B (#117). Per-org
  // prefix / pad / reset policy is configurable from the numbering admin
  // page. Payment is the last chassis-eligible doc type still requiring
  // manual entry.
  const [customerId, setCustomerId] = useState<string | null>(prefilledCustomerId);
  const [invoiceId, setInvoiceId] = useState<string | null>(prefilledInvoiceId);
  // PR A2: state holds integer cents (DollarInput emits number | null).
  const [amountCents, setAmountCents] = useState<number | null>(0);
  const [currency, setCurrency] = useState('USD');
  const [paymentMethod, setPaymentMethod] = useState('');
  // B3 (Wave B): default received_at to today. The operator can edit
  // for back-dated entries (mailed checks, posted-the-next-day ACHs,
  // etc.) but the common case is "received today, recording now".
  const [receivedAt, setReceivedAt] = useState(() => todayIsoDate());
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

  // PR A3: amount-from-balance pre-fill. Fetch the selected invoice (if
  // any) and copy its outstanding balance_cents into the Amount field
  // exactly once per invoice id. Tracked via a ref so a manual edit by
  // the operator is never clobbered, and so flipping the invoice picker
  // to a different invoice re-arms the prefill for the new id.
  const invoice = useInvoice(invoiceId ?? '');
  const prefillAppliedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!invoiceId) return;
    if (prefillAppliedForRef.current === invoiceId) return;
    if (!invoice.data) return;
    const next = resolveInvoiceBalancePrefill(invoice.data.balance_cents);
    if (next !== null) setAmountCents(next);
    prefillAppliedForRef.current = invoiceId;
  }, [invoiceId, invoice.data]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const amountCentsWire = String(amountCents ?? 0);
    const body: {
      customer_id?: string;
      amount_cents: string;
      currency_code: string;
      payment_method?: string;
      reference_number?: string;
      received_at?: string;
      notes?: string;
    } = {
      amount_cents: amountCentsWire,
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
          allocations: [{ invoice_id: invoiceId, amount_cents: amountCentsWire }],
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
        <DollarInput
          label="Amount"
          name="amount_cents"
          value={amountCents}
          onChange={setAmountCents}
          required
        />
        <TextInput
          label="Currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          maxLength={3}
        />
        {/* F-Wave9-AUDIT-V3-WAVE-E-01 (item 2): payment method is a closed
            set of business values, not freeform. Storage shape unchanged
            (lowercase string), so historical rows continue to render and
            the wire contract stays stable. Empty string remains the
            "unspecified" sentinel; the body builder above only includes
            payment_method when non-empty. */}
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Payment method
          </span>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          >
            <option value="">Unspecified</option>
            <option value="ach">ACH</option>
            <option value="wire">Wire</option>
            <option value="check">Check</option>
            <option value="card">Card</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </label>
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
