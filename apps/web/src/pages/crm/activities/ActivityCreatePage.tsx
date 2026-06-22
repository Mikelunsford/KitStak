import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { activitiesKeys } from '@/lib/queryKeys/activities';
import { createActivity } from '@/lib/services/activitiesService';
import {
  ActivityCreateSchema,
  type ActivityCreate,
  type ActivityEntityType,
  type ActivityKind,
} from '@/lib/types/crm';

import { parseEntityTypeParam } from './parseEntityTypeParam';

export { parseEntityTypeParam };

export function ActivityCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  // PR-6 / B5: pre-fill entity_type and entity_id from the URL. The
  // CRM customer detail page (and forthcoming related-entity surfaces)
  // links here as `/crm/activities/new?entity_type=customer&entity_id=<uuid>`.
  // Invalid entity_type falls back to 'customer'.
  const [entityType, setEntityType] = useState<ActivityEntityType>(() =>
    parseEntityTypeParam(searchParams.get('entity_type')),
  );
  const [entityId, setEntityId] = useState(
    () => searchParams.get('entity_id') ?? '',
  );
  const [kind, setKind] = useState<ActivityKind>('note');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (b: ActivityCreate) => createActivity(b),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: activitiesKeys.all });
      navigate('/crm/activities');
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Failed to create.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = ActivityCreateSchema.safeParse({
      entity_type: entityType,
      entity_id: entityId,
      kind,
      subject,
      body: body || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-10">
      <PageHeader title="New activity" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Entity type
          </span>
          <Select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as ActivityEntityType)}
          >
            <option value="customer">Customer</option>
            <option value="contact">Contact</option>
            <option value="lead">Lead</option>
            <option value="opportunity">Opportunity</option>
          </Select>
        </label>
        <TextInput
          label="Entity id"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          required
          className="font-mono text-xs"
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Kind
          </span>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as ActivityKind)}
          >
            <option value="note">Note</option>
            <option value="call">Call</option>
            <option value="meeting">Meeting</option>
            <option value="email">Email</option>
            <option value="task">Task</option>
          </Select>
        </label>
        <TextInput
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Body
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        <Button type="submit" disabled={mutation.isPending} className="self-start">
          {mutation.isPending ? 'Creating.' : 'Create'}
        </Button>
      </form>
    </section>
  );
}
