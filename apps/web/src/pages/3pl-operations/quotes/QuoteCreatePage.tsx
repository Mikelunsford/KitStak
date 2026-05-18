import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useCreateQuote } from '@/lib/hooks/useQuotes';
import { useCurrenciesList } from '@/lib/hooks/useCurrencies';

export function QuoteCreatePage() {
  const navigate = useNavigate();
  const create = useCreateQuote();
  const { data: currencies } = useCurrenciesList();
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const result = await create.mutateAsync({
      number, title: title || null, currency_code: currencyCode,
    });
    navigate(`/3pl-operations/quotes/${result.id}`);
  };

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW QUOTE</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Quote number"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          required
        />
        <TextInput
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">Currency</span>
          <select
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value)}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          >
            {(currencies ?? [{ code: 'USD' }]).map((c) => (
              <option key={c.code} value={c.code}>{c.code}</option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Saving.' : 'Create'}
        </Button>
      </form>
    </section>
  );
}
