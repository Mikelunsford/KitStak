import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { CustomerPicker } from '@/components/ui/pickers';
import { useCreateQuote } from '@/lib/hooks/useQuotes';
import { useCurrenciesList } from '@/lib/hooks/useCurrencies';
import type { CreateQuoteRequest } from '@/lib/types/sales';

/**
 * QuoteCreatePage. Captures the rich quote-header shape that
 * CreateQuoteRequestSchema accepts. Customer is the FK pivot; the rest are
 * optional headers (default_tax_id, payment_method_id, pricing_tier_id are
 * picker-driven once those pages ship; for 6.5 we accept raw UUID inputs).
 *
 * Closes G-QUOTE-FORM-01 (customer picker) and G-QUOTE-FORM-02 (other
 * optional fields).
 */
export function QuoteCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateQuote();
  const { data: currencies } = useCurrenciesList();

  const prefilledCustomerId = searchParams.get('customer_id');

  // F-Wave9-AUTO-NUMBERING-01 (B8): the quotes-api handler now allocates
  // Q-YYYY-NNNNN via the numbering chassis when `number` is absent, so the
  // SPA no longer asks the operator to type it. Per-org prefix / pad / reset
  // policy is configurable from the numbering admin page.
  const [title, setTitle] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(prefilledCustomerId);
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [expirationDate, setExpirationDate] = useState('');
  const [defaultTaxId, setDefaultTaxId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [pricingTierId, setPricingTierId] = useState('');
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const body: CreateQuoteRequest = {
      title: title || null,
      currency_code: currencyCode,
      customer_id: customerId,
      expiration_date: expirationDate || null,
      default_tax_id: defaultTaxId || null,
      payment_method_id: paymentMethodId || null,
      pricing_tier_id: pricingTierId || null,
      notes: notes || null,
      internal_notes: internalNotes || null,
    };
    // F-Wave7-MUTATION-ERRORS-SWEEP-01: switch from await mutateAsync to
    // mutate(input, { onSuccess }) so the mutation.error state is preserved
    // and surfaced in the inline error renderer below.
    create.mutate(body, {
      onSuccess: (result) => {
        navigate(`/3pl-operations/quotes/${result.id}`);
      },
    });
  };

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW QUOTE</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <CustomerPicker
          value={customerId}
          onChange={setCustomerId}
          label="Customer"
        />
        <TextInput
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Currency
          </span>
          <select
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value)}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          >
            {(currencies ?? [{ code: 'USD' }]).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
        <TextInput
          label="Expiration date"
          type="date"
          value={expirationDate}
          onChange={(e) => setExpirationDate(e.target.value)}
        />
        {/* F-Wave9-AUDIT-V3-WAVE-E-01 (item 1): hide the three optional
            raw-UUID inputs from the default view. The audit called out
            that asking the operator to paste a raw UUID for an optional
            FK is template-y and reads as developer-facing scaffolding.
            B2 already replaced the source-quote uuid input with a
            QuotePicker; default_tax_id / payment_method_id /
            pricing_tier_id don't yet have a picker, so we keep them
            available under a disclosure for the rare operator who has
            an id in hand (admin workflows, data migration), but the
            common path is "skip — defaults apply". Data model is
            untouched; CreateQuoteRequest still accepts these nullable
            fields and the body builder above still sends null when the
            inputs are empty. */}
        <details className="border border-line bg-bg-2/40">
          <summary className="px-4 py-2 cursor-pointer text-sm text-ink-dim tracking-wide uppercase">
            Advanced (optional)
          </summary>
          <div className="flex flex-col gap-4 p-4 border-t border-line">
            <TextInput
              label="Default tax id"
              value={defaultTaxId}
              onChange={(e) => setDefaultTaxId(e.target.value)}
              placeholder="leave blank to use the org default"
            />
            <TextInput
              label="Payment method id"
              value={paymentMethodId}
              onChange={(e) => setPaymentMethodId(e.target.value)}
              placeholder="leave blank to use the org default"
            />
            <TextInput
              label="Pricing tier id"
              value={pricingTierId}
              onChange={(e) => setPricingTierId(e.target.value)}
              placeholder="leave blank to use the org default"
            />
          </div>
        </details>
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Internal notes
          </span>
          <textarea
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            rows={2}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Saving.' : 'Create'}
        </Button>
        {create.error && (
          <p className="font-sans text-sm text-accent">
            {create.error instanceof Error ? create.error.message : 'Create quote failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
