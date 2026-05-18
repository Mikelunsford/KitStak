import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { CustomerPicker } from '@/components/ui/pickers';
import { opportunitiesKeys } from '@/lib/queryKeys/opportunities';
import { createOpportunity } from '@/lib/services/opportunitiesService';
import {
  OpportunityCreateSchema,
  OpportunityStageSchema,
  type Opportunity,
  type OpportunityCreate,
  type OpportunityStage,
} from '@/lib/types/crm';

/**
 * OpportunityCreatePage. Closes G-OPP-FORM-01.
 *
 * Customer is the required FK pivot; the opportunity belongs to a customer
 * record per the 0008 schema. Stage defaults to 'discovery' per the schema
 * default; amount_cents and expected_close_date are optional headers. Pre-fills
 * customer_id from the query string so a future "create opportunity from
 * customer" CTA on CustomerDetailPage can land here with context.
 */
export function OpportunityCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const prefilledCustomerId = searchParams.get('customer_id');

  const [customerId, setCustomerId] = useState<string | null>(prefilledCustomerId);
  const [displayName, setDisplayName] = useState('');
  const [stage, setStage] = useState<OpportunityStage>('discovery');
  const [amountCents, setAmountCents] = useState('0');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const stages: OpportunityStage[] = [...OpportunityStageSchema.options];

  const mutation = useMutation({
    mutationFn: (body: OpportunityCreate) => createOpportunity(body),
    onSuccess: (created: Opportunity) => {
      void qc.invalidateQueries({ queryKey: opportunitiesKeys.all });
      navigate(`/crm/opportunities/${created.id}`);
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Failed to save opportunity.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customerId) {
      setError('Customer is required.');
      return;
    }
    const amountParsed = Number(amountCents);
    if (!Number.isFinite(amountParsed) || amountParsed < 0) {
      setError('Amount must be a non-negative integer in cents.');
      return;
    }
    const draft = {
      customer_id: customerId,
      display_name: displayName,
      stage,
      amount_cents: Math.trunc(amountParsed),
      currency_code: currencyCode,
      expected_close_date: expectedCloseDate || undefined,
      notes: notes.trim() || undefined,
    };
    const parsed = OpportunityCreateSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">
        NEW OPPORTUNITY
      </h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <CustomerPicker
          value={customerId}
          onChange={setCustomerId}
          label="Customer"
          required
        />
        <TextInput
          label="Name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Stage
          </span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as OpportunityStage)}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          >
            {stages.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <TextInput
          label="Amount (cents)"
          value={amountCents}
          onChange={(e) => setAmountCents(e.target.value)}
          inputMode="numeric"
        />
        <TextInput
          label="Currency"
          value={currencyCode}
          onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
          maxLength={3}
        />
        <TextInput
          label="Expected close date"
          type="date"
          value={expectedCloseDate}
          onChange={(e) => setExpectedCloseDate(e.target.value)}
        />
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

        {error && <p className="text-accent font-sans text-sm">{error}</p>}

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving.' : 'Save opportunity'}
        </Button>
      </form>
    </section>
  );
}
