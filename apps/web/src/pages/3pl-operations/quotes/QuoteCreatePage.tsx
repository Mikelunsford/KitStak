import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  CustomerPicker,
  TaxPicker,
  PaymentMethodPicker,
  PricingTierPicker,
} from '@/components/ui/pickers';
import { useCreateQuote } from '@/lib/hooks/useQuotes';
import { CurrencyField } from '@/components/ui/CurrencyField';
import { useDefaultExpiration } from '@/lib/hooks/useDefaultExpiration';
import { addExpiration } from '@/lib/quoteExpiration';
import { todayIsoDate } from '@/lib/dates';
import { useTaxesList } from '@/lib/hooks/useTaxes';
import { customersKeys } from '@/lib/queryKeys/customers';
import { paymentMethodsKeys } from '@/lib/queryKeys/paymentMethods';
import { listPaymentMethods } from '@/lib/services/paymentMethodsService';
import { addLineItem } from '@/lib/services/quotesService';
import type { CreateQuoteRequest } from '@/lib/types/sales';
import type { Customer } from '@/lib/types/crm';

import { nextStepToast } from '@/lib/nextStepToast';
import { QuoteCreateLinesEditor } from './QuoteCreateLinesEditor';
import { quoteCreatedMessage } from './quoteCreatedToast';
import {
  quoteDraftsToLineRequests,
  type QuoteLineDraft,
} from './quoteLineDraft';

/**
 * QuoteCreatePage. Captures the rich quote-header shape that
 * CreateQuoteRequestSchema accepts. Customer is the FK pivot; the rest are
 * optional headers (default_tax_id, payment_method_id, pricing_tier_id are
 * picker-driven via TaxPicker / PaymentMethodPicker / PricingTierPicker, P1-2).
 *
 * Closes G-QUOTE-FORM-01 (customer picker) and G-QUOTE-FORM-02 (other
 * optional fields).
 *
 * R-W13-UX-02: line items can now be staged inline on this screen instead
 * of forcing a header-first-then-detail-page round trip. The quotes-api
 * create handler accepts the header shape only, so the submit flow is two
 * stage in one user action: POST the header, then POST each staged line
 * over /quotes/:id/line-items. On a mid-sequence line failure the operator
 * lands on the detail page with the rest still addable there.
 */
export function QuoteCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateQuote();
  const qc = useQueryClient();
  const defaultExpiration = useDefaultExpiration();
  const { data: taxes } = useTaxesList();
  const { data: paymentMethods } = useQuery({
    queryKey: paymentMethodsKeys.list(),
    queryFn: () => listPaymentMethods(),
  });

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
  const [lines, setLines] = useState<QuoteLineDraft[]>([]);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [submittingLines, setSubmittingLines] = useState(false);

  // Honor the "leave blank to use the org default" placeholder: seed the
  // header default_tax_id / payment_method_id from the org default once the
  // lists arrive, but only when the field is still blank. Seeding on the
  // empty-string transition means an operator's explicit choice (typed or
  // cleared) is never clobbered; the guard makes the effect idempotent.
  useEffect(() => {
    const defaultTax = (taxes ?? []).find((tax) => tax.default_for_org);
    if (defaultTax) {
      setDefaultTaxId((current) => (current === '' ? defaultTax.id : current));
    }
  }, [taxes]);

  useEffect(() => {
    const defaultMethod = (paymentMethods ?? []).find((m) => m.default_for_org);
    if (defaultMethod) {
      setPaymentMethodId((current) => (current === '' ? defaultMethod.id : current));
    }
  }, [paymentMethods]);

  // Seed the expiration date from the org default (today plus the configured
  // duration) exactly once, when the setting resolves. A null default leaves the
  // field blank (no expiration). The ref guard plus the empty-string check both
  // ensure an operator's own date is never clobbered.
  const expSeeded = useRef(false);
  useEffect(() => {
    if (expSeeded.current) return;
    if (defaultExpiration === undefined) return;
    expSeeded.current = true;
    if (defaultExpiration) {
      const computed = addExpiration(todayIsoDate(), defaultExpiration);
      if (computed) {
        setExpirationDate((current) => (current === '' ? computed : current));
      }
    }
  }, [defaultExpiration]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setLinesError(null);
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
      onSuccess: async (result) => {
        // P0-2: prime the customer detail cache from the record the
        // CustomerPicker already loaded, so the detail page header shows the
        // name immediately instead of flashing the raw id while useCustomer
        // fetches. Best-effort: this form's picker uses customersKeys.list({})
        // (no status filter); if the record is not cached (for example a
        // quick-created customer) the QuoteDetailPage loading gate covers it.
        if (result.customer_id) {
          const picked = qc
            .getQueryData<Customer[]>(customersKeys.list({}))
            ?.find((c) => c.id === result.customer_id);
          if (picked) {
            qc.setQueryData(customersKeys.detail(result.customer_id), picked);
          }
        }
        // R-W13-UX-02: stage 2. Replay the staged line drafts over the
        // line-item POST endpoint (the create handler does not accept
        // lines inline). Stop on the first failure so the operator can
        // review on the detail page and re-add the remainder rather than
        // silently dropping rows. Order is preserved via position.
        const requests = quoteDraftsToLineRequests(lines);
        if (requests.length > 0) {
          setSubmittingLines(true);
          try {
            for (const request of requests) {
              await addLineItem(result.id, request);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'unknown error';
            setLinesError(
              `Quote created but a line failed: ${msg}. Add the rest on the detail page.`,
            );
            setSubmittingLines(false);
            navigate(`/quotes/${result.id}`);
            return;
          }
          setSubmittingLines(false);
        }
        // F-UIUX-TOASTS-01 (Pattern A): confirm the create and name the next
        // verb. With staged lines the quote is ready to send; without, the next
        // step is adding lines on the detail page the operator just landed on.
        nextStepToast(quoteCreatedMessage(result.number, requests.length));
        navigate(`/quotes/${result.id}`);
      },
    });
  };

  const pending = create.isPending || submittingLines;

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <PageHeader title="New quote" />
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 max-w-xl">
        <CustomerPicker
          value={customerId}
          onChange={setCustomerId}
          label="Customer"
          required
        />
        <TextInput
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {/* P1-2: the three optional reference FKs (default tax, payment method,
            pricing tier) are named pickers now, not raw-UUID text inputs
            (F-Wave9-AUDIT-V3-WAVE-E-01 item 1 flagged the raw UUIDs as
            developer-facing scaffolding). They stay under the Advanced
            disclosure and stay optional; CreateQuoteRequest still accepts
            nullable id fields and the body builder sends null when none is
            chosen. The tax / payment seeds below still pre-select the org
            default, now shown by name instead of a UUID. */}
        <details className="border border-line bg-bg-2/40">
          <summary className="px-4 py-2 cursor-pointer text-sm text-ink-dim tracking-wide uppercase">
            Advanced (optional)
          </summary>
          <div className="flex flex-col gap-4 p-4 border-t border-line">
            <CurrencyField value={currencyCode} onChange={setCurrencyCode} />
            <TextInput
              label="Expiration date"
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
            />
            <TaxPicker
              value={defaultTaxId || null}
              onChange={(id) => setDefaultTaxId(id ?? '')}
            />
            <PaymentMethodPicker
              value={paymentMethodId || null}
              onChange={(id) => setPaymentMethodId(id ?? '')}
            />
            <PricingTierPicker
              value={pricingTierId || null}
              onChange={(id) => setPricingTierId(id ?? '')}
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
        </div>

        {/* R-W13-UX-02: stage line items inline. Submitted with the header
            in one action via the two-stage flow in onSubmit. */}
        <QuoteCreateLinesEditor
          lines={lines}
          onChange={setLines}
          currencyCode={currencyCode}
          disabled={pending}
        />

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving.' : 'Create'}
        </Button>
        {linesError && (
          <p className="font-sans text-sm text-accent">{linesError}</p>
        )}
        {create.error && (
          <p className="font-sans text-sm text-accent">
            {create.error instanceof Error ? create.error.message : 'Create quote failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
