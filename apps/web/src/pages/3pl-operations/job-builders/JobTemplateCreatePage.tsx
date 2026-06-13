// JobTemplateCreatePage (Wave 12 Phase A2). Creates a Job Builder template.
// Native useState plus Zod safeParse (no react-hook-form). name is required;
// variant defaults to custom; job type and default BOM item are optional spine
// references; template_number is optional and the server fills the next JB-
// string when it is blank.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { ItemPicker } from '@/components/ui/pickers';
import { useCreateJobTemplate } from '@/lib/hooks/useJobTemplates';
import type { JobTemplateVariant } from '@/lib/services/jobTemplatesService';
import { JobTemplateCreateSchema } from '@/lib/types/threepl';
import { jobTypesKeys } from '@/lib/queryKeys/jobTypes';
import { listJobTypes } from '@/lib/services/jobTypesService';

const VARIANTS: ReadonlyArray<JobTemplateVariant> = [
  'kit',
  'sidekick',
  'repack',
  'labeling',
  'inspection',
  'custom',
];

export function JobTemplateCreatePage() {
  const navigate = useNavigate();
  const create = useCreateJobTemplate();

  const [name, setName] = useState('');
  const [variant, setVariant] = useState<JobTemplateVariant>('custom');
  const [jobTypeId, setJobTypeId] = useState('');
  const [defaultBomItemId, setDefaultBomItemId] = useState<string | null>(null);
  const [templateNumber, setTemplateNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const jobTypes = useQuery({
    queryKey: jobTypesKeys.list(),
    queryFn: () => listJobTypes(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const jobTypeList = jobTypes.data ?? [];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const parsed = JobTemplateCreateSchema.safeParse({
      name,
      variant,
      job_type_id: jobTypeId ? jobTypeId : undefined,
      default_bom_item_id: defaultBomItemId ?? undefined,
      template_number: templateNumber.trim() ? templateNumber.trim() : undefined,
      notes: notes.trim() ? notes.trim() : undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }

    create.mutate(parsed.data, {
      onSuccess: (r) => {
        navigate(`/3pl-operations/job-builders/${r.id}`);
      },
    });
  };

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <PageHeader eyebrow="3PL Operations" title="New job builder" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Variant
          </span>
          <Select
            value={variant}
            onChange={(e) => setVariant(e.target.value as JobTemplateVariant)}
          >
            {VARIANTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Job type
          </span>
          <Select
            value={jobTypeId}
            onChange={(e) => setJobTypeId(e.target.value)}
            disabled={jobTypes.isLoading}
          >
            <option value="">{jobTypes.isLoading ? 'Loading.' : 'None'}</option>
            {jobTypeList.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </Select>
        </label>
        <ItemPicker
          value={defaultBomItemId}
          onChange={(id) => setDefaultBomItemId(id)}
          filter={{ kind: 'good' }}
          label="Default BOM item"
          placeholder="None"
        />
        <TextInput
          label="Template number"
          value={templateNumber}
          onChange={(e) => setTemplateNumber(e.target.value)}
          placeholder="Leave blank to auto-assign JB-"
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Saving.' : 'Create job builder'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/3pl-operations/job-builders')}
          >
            Cancel
          </Button>
        </div>

        {formError && (
          <p className="font-sans text-sm text-accent">{formError}</p>
        )}
        {create.error && (
          <p className="font-sans text-sm text-accent">
            {create.error instanceof Error
              ? create.error.message
              : 'Create job builder failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
