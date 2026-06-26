// ProjectEditPage (Wave 15). Edits a project header (name, customer, job type,
// budget, currency, dates, description) over the already-live PATCH
// /projects/:id edge route via useUpdateProject. Mirrors ProjectCreatePage's
// field set, seeding state from useProject in a useEffect. The project number
// is the canonical identifier and is shown read-only, not patched.

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { CustomerPicker } from '@/components/ui/pickers';
import { CurrencyField } from '@/components/ui/CurrencyField';
import { useProject, useUpdateProject } from '@/lib/hooks/useProjects';
import { UpdateProjectRequestSchema } from '@/lib/types/sales';

export function ProjectEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useProject(id);
  const update = useUpdateProject(id ?? '');

  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [jobTypeId, setJobTypeId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [budgetCents, setBudgetCents] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const p = query.data?.project;
    if (p) {
      setNumber(p.number);
      setName(p.name);
      setDescription(p.description ?? '');
      setCustomerId(p.customer_id);
      setJobTypeId(p.job_type_id ?? '');
      setCurrencyCode(p.currency_code);
      setBudgetCents(String(p.budget_cents));
      setStartDate(p.start_date ?? '');
      setDueDate(p.due_date ?? '');
    }
  }, [query.data]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const parsed = UpdateProjectRequestSchema.safeParse({
      name,
      description: description || null,
      customer_id: customerId,
      job_type_id: jobTypeId || null,
      currency_code: currencyCode,
      budget_cents: budgetCents,
      start_date: startDate || null,
      due_date: dueDate || null,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }

    update.mutate(parsed.data, {
      onSuccess: () => navigate(`/projects/${id}`),
    });
  };

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return <p className="px-8 py-10 font-sans text-accent">Project not found.</p>;
  }

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <PageHeader title="Edit project" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput label="Project number" value={number} disabled />
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
        <details className="border border-line bg-bg-2/40">
          <summary className="px-4 py-2 cursor-pointer text-sm text-ink-dim tracking-wide uppercase">
            Advanced (optional)
          </summary>
          <div className="flex flex-col gap-4 p-4 border-t border-line">
            <CurrencyField value={currencyCode} onChange={setCurrencyCode} />
          </div>
        </details>

        <div className="flex gap-2">
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Saving.' : 'Save project'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(`/projects/${id}`)}
          >
            Cancel
          </Button>
        </div>

        {formError && (
          <p className="font-sans text-sm text-accent">{formError}</p>
        )}
        {update.error && (
          <p className="font-sans text-sm text-accent">
            {update.error instanceof Error ? update.error.message : 'Save project failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
