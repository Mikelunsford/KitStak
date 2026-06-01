import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useLead } from '@/lib/hooks/useLead';
import { leadsKeys } from '@/lib/queryKeys/leads';
import { updateLead } from '@/lib/services/leadsService';
import {
  LeadPatchSchema,
  LeadSourceSchema,
  type LeadPatch,
  type LeadSource,
} from '@/lib/types/crm';

export function LeadEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useLead(id);

  const [companyName, setCompanyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [source, setSource] = useState<LeadSource>('inbound');
  const [estimatedValueCents, setEstimatedValueCents] = useState('0');
  const [currencyCode, setCurrencyCode] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      const l = query.data;
      setDisplayName(l.display_name);
      setCompanyName(l.company_name ?? '');
      setPrimaryEmail(l.primary_email ?? '');
      setPrimaryPhone(l.primary_phone ?? '');
      setSource((l.source ?? 'inbound') as LeadSource);
      setEstimatedValueCents(String(l.estimated_value_cents));
      setCurrencyCode(l.currency_code ?? '');
      setNotes(l.notes ?? '');
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: LeadPatch) => updateLead(id as string, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leadsKeys.all });
      navigate(`/crm/leads/${id}`);
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Failed to save lead.'),
  });

  const sources: LeadSource[] = [...LeadSourceSchema.options];

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const valueParsed = Number(estimatedValueCents);
    if (!Number.isFinite(valueParsed) || valueParsed < 0 || !Number.isInteger(valueParsed)) {
      setError('Estimated value must be a non-negative whole number of cents.');
      return;
    }
    const draft = {
      display_name: displayName,
      company_name: companyName.trim() || null,
      primary_email: primaryEmail.trim() || null,
      primary_phone: primaryPhone.trim() || null,
      source,
      estimated_value_cents: valueParsed,
      currency_code: currencyCode.trim() || null,
      notes: notes.trim() || null,
    };
    const parsed = LeadPatchSchema.safeParse(draft);
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
    return <p className="px-8 py-10 font-sans text-accent">Lead not found.</p>;
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">EDIT LEAD</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Display name</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Company name</span>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Optional"
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Primary email</span>
          <input
            type="email"
            value={primaryEmail}
            onChange={(e) => setPrimaryEmail(e.target.value)}
            placeholder="Optional"
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Primary phone</span>
          <input
            type="tel"
            value={primaryPhone}
            onChange={(e) => setPrimaryPhone(e.target.value)}
            placeholder="Optional"
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Source</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as LeadSource)}
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent"
          >
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Estimated value (cents)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={estimatedValueCents}
            onChange={(e) => setEstimatedValueCents(e.target.value)}
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
            placeholder="Optional, e.g. USD"
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
