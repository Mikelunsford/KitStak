// SupplyPlanCreatePage (Wave 12 Phase A5). Creates a draft supply plan, tied to
// a project as the demand source. Warehouse is left to the release step (it
// defaults to the org default), so the create form stays minimal: project plus
// notes. plan_number (SUP-) is allocated server-side. On success, route to the
// new plan's detail page to add demand lines and release.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProjectPicker } from '@/components/ui/pickers';
import { useCreateSupplyPlan } from '@/lib/hooks/useSupplyPlans';

export function SupplyPlanCreatePage() {
  const navigate = useNavigate();
  const create = useCreateSupplyPlan();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        project_id: projectId,
        notes: notes.trim() ? notes.trim() : null,
      },
      {
        onSuccess: (plan) =>
          navigate(`/3pl-operations/supply-plans/${plan.id}`),
      },
    );
  };

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-12">
      <PageHeader title="New supply plan" />

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 border border-line p-6"
      >
        <ProjectPicker
          value={projectId}
          onChange={setProjectId}
          label="Project (the demand source)"
        />
        <TextInput
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex gap-3">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating.' : 'Create supply plan'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate('/3pl-operations/supply-plans')}
          >
            Cancel
          </Button>
        </div>
        {create.isError && (
          <p className="font-sans text-sm text-accent">
            {create.error instanceof Error
              ? create.error.message
              : 'Create supply plan failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
