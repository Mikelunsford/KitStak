import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useOpportunity } from '@/lib/hooks/useOpportunity';
import { opportunitiesKeys } from '@/lib/queryKeys/opportunities';
import { updateOpportunity } from '@/lib/services/opportunitiesService';
import {
  OpportunityPatchSchema,
  OpportunityStageSchema,
  type OpportunityPatch,
  type OpportunityStage,
} from '@/lib/types/crm';

export function OpportunityEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useOpportunity(id);

  const [displayName, setDisplayName] = useState('');
  const [amountCents, setAmountCents] = useState('0');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [stage, setStage] = useState<OpportunityStage>('discovery');
  const [probabilityPct, setProbabilityPct] = useState('0');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      const o = query.data;
      setDisplayName(o.display_name);
      setAmountCents(String(o.amount_cents));
      setCurrencyCode(o.currency_code ?? 'USD');
      setStage(o.stage);
      setProbabilityPct(String(o.probability_pct));
      setExpectedCloseDate(o.expected_close_date ?? '');
      setNotes(o.notes ?? '');
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: OpportunityPatch) => updateOpportunity(id as string, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: opportunitiesKeys.all });
      navigate(`/crm/opportunities/${id}`);
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Failed to save opportunity.'),
  });

  const stages: OpportunityStage[] = [...OpportunityStageSchema.options];

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amountParsed = Number(amountCents);
    if (!Number.isFinite(amountParsed) || amountParsed < 0 || !Number.isInteger(amountParsed)) {
      setError('Amount must be a non-negative whole number of cents.');
      return;
    }
    const probParsed = Number(probabilityPct);
    if (!Number.isInteger(probParsed) || probParsed < 0 || probParsed > 100) {
      setError('Probability must be a whole number between 0 and 100.');
      return;
    }
    const draft = {
      display_name: displayName,
      amount_cents: amountParsed,
      currency_code: currencyCode,
      stage,
      probability_pct: probParsed,
      expected_close_date: expectedCloseDate || null,
      notes: notes.trim() || null,
    };
    const parsed = OpportunityPatchSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data);
  }

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return (
      <p className="px-8 py-10 font-sans text-accent">Opportunity not found.</p>
    );
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">
        EDIT OPPORTUNITY
      </h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Name</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Stage</span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as OpportunityStage)}
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent"
          >
            {stages.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Amount (cents)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={amountCents}
            onChange={(e) => setAmountCents(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Currency code</span>
          <input
            type="text"
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
            maxLength={3}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Probability (%)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            value={probabilityPct}
            onChange={(e) => setProbabilityPct(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Expected close date</span>
          <input
            type="date"
            value={expectedCloseDate}
            onChange={(e) => setExpectedCloseDate(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent"
          />
        </label>
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="self-start px-4 py-2 bg-accent text-on-primary font-display tracking-wider disabled:opacity-50"
        >
          {mutation.isPending ? 'SAVING.' : 'SAVE'}
        </button>
      </form>
    </section>
  );
}
