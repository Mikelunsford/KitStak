// Scope-of-work tab: the run-scoped job_run_sow_steps, sequenced top to bottom.
// CRUD against the artifact hooks. Uses hooks, so it is not element-tree-walk
// tested. ADR 0006 P2c.

import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import {
  useCreateJobRunSowStep,
  usePatchJobRunSowStep,
  useDeleteJobRunSowStep,
} from '@/lib/hooks/useJobArtifacts';
import type { JobRunSowStep } from '@/lib/types/jobbuilder';

const INPUT =
  'bg-bg-2 border border-line text-ink px-2 py-1.5 font-sans text-sm focus:outline-none focus:border-accent';

export function SowTab({ runId, steps }: { runId: string; steps: JobRunSowStep[] }) {
  const create = useCreateJobRunSowStep(runId);
  const patch = usePatchJobRunSowStep(runId);
  const remove = useDeleteJobRunSowStep(runId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-lg tracking-wide text-ink">Scope of work</h3>
          <p className="font-sans text-sm text-ink-dim">
            Build processes for this job, sequenced top to bottom.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => create.mutate({ title: 'New step' })}
          disabled={create.isPending}
        >
          <span className="flex items-center gap-1.5">
            <Plus className="h-4 w-4" /> Add step
          </span>
        </Button>
      </div>

      {steps.length === 0 ? (
        <p className="border border-line bg-bg-2 px-4 py-6 text-center font-sans text-sm text-ink-faint">
          No steps yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {steps.map((step, idx) => (
            <div key={step.id} className="flex items-center gap-3 border border-line bg-bg-2 p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-line font-sans text-sm text-ink-dim tabular-nums">
                {idx + 1}
              </span>
              <div className="grid flex-1 grid-cols-[1fr_1.2fr] gap-2.5">
                <input
                  defaultValue={step.title}
                  placeholder="Process"
                  onBlur={(e) => {
                    if (e.target.value !== step.title) patch.mutate({ stepId: step.id, input: { title: e.target.value } });
                  }}
                  className={INPUT}
                />
                <input
                  defaultValue={step.detail ?? ''}
                  placeholder="Detail / standard"
                  onBlur={(e) => {
                    if (e.target.value !== (step.detail ?? '')) patch.mutate({ stepId: step.id, input: { detail: e.target.value } });
                  }}
                  className={INPUT}
                />
              </div>
              <button
                type="button"
                onClick={() => remove.mutate(step.id)}
                title="Remove step"
                className="text-ink-faint hover:text-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
