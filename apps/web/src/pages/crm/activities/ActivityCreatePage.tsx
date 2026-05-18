import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { activitiesKeys } from '@/lib/queryKeys/activities';
import { createActivity } from '@/lib/services/activitiesService';
import {
  ActivityCreateSchema,
  type ActivityCreate,
  type ActivityEntityType,
  type ActivityKind,
} from '@/lib/types/crm';

export function ActivityCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [entityType, setEntityType] = useState<ActivityEntityType>('customer');
  const [entityId, setEntityId] = useState('');
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
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create.'),
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
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW ACTIVITY</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Entity type</span>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as ActivityEntityType)}
            className="bg-bg-2 border border-line px-3 py-2"
          >
            <option value="customer">Customer</option>
            <option value="contact">Contact</option>
            <option value="lead">Lead</option>
            <option value="opportunity">Opportunity</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Entity id</span>
          <input
            type="text"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2 font-mono text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ActivityKind)}
            className="bg-bg-2 border border-line px-3 py-2"
          >
            <option value="note">Note</option>
            <option value="call">Call</option>
            <option value="meeting">Meeting</option>
            <option value="email">Email</option>
            <option value="task">Task</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Subject</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Body</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
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
