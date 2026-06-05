// ExchangeRateCreatePage. Migration to the shared UI kit (F-Wave10-UI-KIT-01):
// PageHeader + TextInput + kit Button replace the hand-rolled header, raw
// inputs, and raw submit button; a secondary Cancel is added. The 1e-9 helper
// note and the positive-integer rate validation are preserved. The rate field
// stays type=text with inputMode=numeric so the large integer is never coerced
// through a float; rate_e9 is a fixed-point scalar, not money.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { exchangeRatesKeys } from '@/lib/queryKeys/exchangeRates';
import { createExchangeRate } from '@/lib/services/exchangeRatesService';
import {
  ExchangeRateCreateSchema,
  type ExchangeRateCreate,
} from '@/lib/types/sales';

export function ExchangeRateCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [baseCurrencyCode, setBaseCurrencyCode] = useState('USD');
  const [quoteCurrencyCode, setQuoteCurrencyCode] = useState('');
  const [rateE9, setRateE9] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [source, setSource] = useState('manual');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: ExchangeRateCreate) => createExchangeRate(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: exchangeRatesKeys.all });
      navigate('/settings/sales-config/exchange-rates');
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Failed to create exchange rate.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const rateValue = rateE9.trim();
    const parsedRate = Number(rateValue);
    if (!Number.isInteger(parsedRate) || parsedRate <= 0) {
      setError('Rate (1e-9) must be a positive whole number.');
      return;
    }
    const draft = {
      base_currency_code: baseCurrencyCode.trim().toUpperCase(),
      quote_currency_code: quoteCurrencyCode.trim().toUpperCase(),
      rate_e9: parsedRate,
      effective_date: effectiveDate,
      source: source.trim() || 'manual',
    };
    const parsed = ExchangeRateCreateSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader
        eyebrow="Sales config / Exchange rates"
        title="New exchange rate"
      />
      <p className="font-sans text-sm text-ink-dim">
        Rate is stored as an integer in units of 1e-9 (one billionth). For
        example, USD/EUR at 0.92 is 920000000.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <TextInput
          label="Base currency (3-letter code)"
          value={baseCurrencyCode}
          onChange={(e) => setBaseCurrencyCode(e.target.value.toUpperCase())}
          maxLength={3}
          required
        />
        <TextInput
          label="Quote currency (3-letter code)"
          value={quoteCurrencyCode}
          onChange={(e) => setQuoteCurrencyCode(e.target.value.toUpperCase())}
          maxLength={3}
          required
        />
        <TextInput
          label="Rate (integer, 1e-9 units)"
          value={rateE9}
          onChange={(e) => setRateE9(e.target.value)}
          inputMode="numeric"
          placeholder="e.g. 920000000"
          required
          className="font-mono"
        />
        <TextInput
          label="Effective date"
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
          required
        />
        <TextInput
          label="Source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="manual"
        />
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating.' : 'Create'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              navigate('/settings/sales-config/exchange-rates')
            }
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
