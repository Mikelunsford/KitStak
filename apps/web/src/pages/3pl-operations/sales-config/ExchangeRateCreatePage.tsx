import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { exchangeRatesKeys } from '@/lib/queryKeys/exchangeRates';
import { createExchangeRate } from '@/lib/services/exchangeRatesService';
import { ExchangeRateCreateSchema, type ExchangeRateCreate } from '@/lib/types/sales';

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
      navigate('/3pl-operations/sales-config/exchange-rates');
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create exchange rate.'),
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
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW EXCHANGE RATE</h1>
      <p className="font-sans text-sm text-ink-dim">
        Rate is stored as an integer in units of 1e-9 (one billionth). For example, USD/EUR at
        0.92 is 920000000.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Base currency (3-letter code)</span>
          <input
            type="text"
            value={baseCurrencyCode}
            onChange={(e) => setBaseCurrencyCode(e.target.value.toUpperCase())}
            maxLength={3}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Quote currency (3-letter code)</span>
          <input
            type="text"
            value={quoteCurrencyCode}
            onChange={(e) => setQuoteCurrencyCode(e.target.value.toUpperCase())}
            maxLength={3}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Rate (integer, 1e-9 units)</span>
          <input
            type="text"
            inputMode="numeric"
            value={rateE9}
            onChange={(e) => setRateE9(e.target.value)}
            placeholder="e.g. 920000000"
            required
            className="bg-bg-2 border border-line px-3 py-2 font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Effective date</span>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Source</span>
          <input
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="manual"
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="self-start px-4 py-2 bg-accent text-on-primary font-display tracking-wider disabled:opacity-50"
        >
          {mutation.isPending ? 'CREATING.' : 'CREATE'}
        </button>
      </form>
    </section>
  );
}
