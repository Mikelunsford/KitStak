import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useConvertLead } from '@/lib/hooks/useConvertLead';
import {
  LeadConvertSchema,
  type LeadConvert,
} from '@/lib/types/crm';

/**
 * Lead convert form. Routes to the dedicated /:id/convert RPC wrapper rather
 * than a generic PATCH so the convert_lead transaction stays atomic.
 */
export function LeadConvertPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mutation = useConvertLead(id as string);

  const [createCustomer, setCreateCustomer] = useState(true);
  const [customerId, setCustomerId] = useState('');
  const [opportunityName, setOpportunityName] = useState('');
  const [amountCents, setAmountCents] = useState('0');
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const draft: Partial<LeadConvert> = {
      create_customer: createCustomer,
      customer_id: createCustomer ? null : customerId,
      opportunity_name: opportunityName,
      opportunity_amount_cents: Number.parseInt(amountCents, 10) || 0,
      opportunity_currency_code: currency || undefined,
    };
    const parsed = LeadConvertSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data, {
      onSuccess: (res) => navigate(`/crm/opportunities/${res.opportunity_id}`),
      onError: (e2) => setError(e2 instanceof Error ? e2.message : 'Failed to convert.'),
    });
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">CONVERT LEAD</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={createCustomer}
            onChange={(e) => setCreateCustomer(e.target.checked)}
          />
          <span className="text-sm">Create a new customer from this lead</span>
        </label>
        {!createCustomer ? (
          <label className="flex flex-col gap-1">
            <span className="text-sm text-ink-dim">Existing customer id</span>
            <input
              type="text"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="bg-bg-2 border border-line px-3 py-2 font-mono text-xs"
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Opportunity name</span>
          <input
            type="text"
            value={opportunityName}
            onChange={(e) => setOpportunityName(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Amount (cents)</span>
          <input
            type="number"
            min={0}
            value={amountCents}
            onChange={(e) => setAmountCents(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2 font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Currency (ISO 4217)</span>
          <input
            type="text"
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className="bg-bg-2 border border-line px-3 py-2 font-mono w-24"
          />
        </label>
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="self-start px-4 py-2 bg-accent text-on-primary font-display tracking-wider disabled:opacity-50"
        >
          {mutation.isPending ? 'CONVERTING.' : 'CONVERT'}
        </button>
      </form>
    </section>
  );
}
