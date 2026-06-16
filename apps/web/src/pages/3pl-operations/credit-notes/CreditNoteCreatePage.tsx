import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { CustomerPicker, InvoicePicker } from '@/components/ui/pickers';
import { useCreateCreditNote } from '@/lib/hooks/useCreditNotes';

/**
 * CreditNoteCreatePage. Closes G-CN-FORM-01. Mirrors PaymentCreatePage shape:
 * customer selection drives the optional source-invoice picker so an operator
 * can attach the new credit note to the invoice it relates to. The credit
 * note record is amount_cents based per the current finance schema; line item
 * support lives behind a follow-up once the apply flow proves out.
 */
export function CreditNoteCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateCreditNote();

  const prefilledCustomerId = searchParams.get('customer_id');
  const prefilledInvoiceId = searchParams.get('invoice_id');

  const [creditNoteNumber, setCreditNoteNumber] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(prefilledCustomerId);
  const [sourceInvoiceId, setSourceInvoiceId] = useState<string | null>(
    prefilledInvoiceId,
  );
  const [amountCents, setAmountCents] = useState('0');
  const [currency, setCurrency] = useState('USD');
  const [reason, setReason] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body: {
      credit_note_number: string;
      customer_id?: string;
      source_invoice_id?: string;
      currency_code?: string;
      amount_cents: number | string;
      reason?: string;
    } = {
      credit_note_number: creditNoteNumber,
      amount_cents: amountCents,
      currency_code: currency,
    };
    if (customerId) body.customer_id = customerId;
    if (sourceInvoiceId) body.source_invoice_id = sourceInvoiceId;
    if (reason) body.reason = reason;

    const cn = await create.mutateAsync(body);
    navigate(`/invoicing/credit-notes/${cn.id}`);
  };

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <PageHeader eyebrow="Invoicing / Credit notes" title="New credit note" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Credit note number"
          value={creditNoteNumber}
          onChange={(e) => setCreditNoteNumber(e.target.value)}
          required
        />
        <CustomerPicker
          value={customerId}
          onChange={(v) => {
            setCustomerId(v);
            if (v !== customerId) setSourceInvoiceId(null);
          }}
          label="Customer"
          required
        />
        <InvoicePicker
          value={sourceInvoiceId}
          onChange={setSourceInvoiceId}
          label="Source invoice (optional)"
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
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Reason
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        {create.error && (
          <p className="text-accent font-sans text-sm">
            {(create.error as Error).message}
          </p>
        )}

        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Saving.' : 'Save credit note'}
        </Button>
      </form>
    </section>
  );
}
