import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { CustomerPicker } from '@/components/ui/pickers';
import { useCreateProject } from '@/lib/hooks/useProjects';
import { useCurrenciesList } from '@/lib/hooks/useCurrencies';
import type { CreateProjectRequest } from '@/lib/types/sales';

/**
 * ProjectCreatePage. Captures customer, job type, currency, budget, dates
 * alongside number + name. Closes G-PROJECT-FORM-01. The source quote linkage
 * happens through the convert-quote-to-project flow; standalone creation is
 * the path for projects that did not start as a quote.
 */
export function ProjectCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateProject();
  const { data: currencies } = useCurrenciesList();

  // quote_id is recognised here so callers can deep-link from a quote, but
  // CreateProjectRequestSchema does not accept a source_quote_id field today.
  // The convert-quote-to-project flow lives on QuoteDetailPage; this page is
  // the standalone path. The customer_id pivot is the part we can prefill.
  const prefilledCustomerId = searchParams.get('customer_id');

  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(prefilledCustomerId);
  const [jobTypeId, setJobTypeId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [budgetCents, setBudgetCents] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const body: CreateProjectRequest = {
      number,
      name,
      description: description || null,
      customer_id: customerId,
      job_type_id: jobTypeId || null,
      currency_code: currencyCode,
      budget_cents: budgetCents,
      start_date: startDate || null,
      due_date: dueDate || null,
    };
    // F-Wave7-MUTATION-ERRORS-SWEEP-01: switch from await mutateAsync to
    // mutate(input, { onSuccess }) so a 4xx surfaces in the inline error
    // renderer below instead of silently failing.
    create.mutate(body, {
      onSuccess: (r) => {
        navigate(`/projects/${r.id}`);
      },
    });
  };

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <PageHeader eyebrow="Make / Projects" title="New project" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Project number"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          required
        />
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <CustomerPicker
          value={customerId}
          onChange={setCustomerId}
          label="Customer"
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Description
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>
        <TextInput
          label="Job type id"
          value={jobTypeId}
          onChange={(e) => setJobTypeId(e.target.value)}
          placeholder="optional uuid"
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Currency
          </span>
          <Select
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value)}
          >
            {(currencies ?? [{ code: 'USD' }]).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </Select>
        </label>
        <TextInput
          label="Budget (cents)"
          value={budgetCents}
          onChange={(e) => setBudgetCents(e.target.value)}
          inputMode="numeric"
        />
        <TextInput
          label="Planned start"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <TextInput
          label="Planned end"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Saving.' : 'Create'}
        </Button>
        {create.error && (
          <p className="font-sans text-sm text-accent">
            {create.error instanceof Error ? create.error.message : 'Create project failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
