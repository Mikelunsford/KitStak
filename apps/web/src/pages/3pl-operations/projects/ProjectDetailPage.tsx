import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import {
  useProject, useTransitionProject, useCreatePhase,
  useTransitionPhase, useReorderPhases,
} from '@/lib/hooks/useProjects';
import {
  PROJECT_FSM, PROJECT_PHASE_FSM, canTransition,
  type ProjectState, type ProjectPhaseState,
} from '@/lib/workflow/sales';

const PROJECT_TARGETS: ProjectState[] = [
  'pending', 'ready_to_build', 'in_production',
  'ready_to_ship', 'completed', 'cancelled',
];

const PHASE_TARGETS: ProjectPhaseState[] = [
  'pending', 'active', 'completed', 'cancelled',
];

export function ProjectDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useProject(id);
  const transition = useTransitionProject(id ?? '');
  const createPhase = useCreatePhase(id ?? '');
  const transitionPhase = useTransitionPhase(id ?? '');
  const reorder = useReorderPhases(id ?? '');
  const [phaseName, setPhaseName] = useState('');

  if (isLoading) return <p className="p-8 text-ink-dim">Loading.</p>;
  if (error || !data) return <p className="p-8 text-accent">Project not found.</p>;

  const { project, phases } = data;
  const state = project.state as ProjectState;

  const onAddPhase = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    await createPhase.mutateAsync({ name: phaseName });
    setPhaseName('');
  };

  const movePhase = (index: number, delta: number) => {
    const next = phases.map((p) => p.id);
    const newIndex = index + delta;
    if (newIndex < 0 || newIndex >= next.length) return;
    const aId = next[index];
    const bId = next[newIndex];
    if (aId === undefined || bId === undefined) return;
    next[index] = bId;
    next[newIndex] = aId;
    reorder.mutate({ phase_ids: next });
  };

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-4xl font-display tracking-wide text-ink">{project.number}</h1>
          <p className="text-ink-dim">{project.name}</p>
        </div>
        <span className="px-3 py-1 border border-line font-mono text-sm">{state}</span>
      </header>

      <div className="flex flex-wrap gap-2">
        {PROJECT_TARGETS
          .filter((to) => to !== state && canTransition(PROJECT_FSM, state, to))
          .map((to) => (
            <Button key={to} variant="secondary" onClick={() => transition.mutate({ to })}>
              Move to {to.replace(/_/g, ' ')}
            </Button>
          ))}
      </div>

      <h2 className="text-2xl font-display tracking-wider text-ink mt-4">PHASES</h2>
      <ol className="flex flex-col gap-3">
        {phases.map((phase, index) => {
          const ps = phase.state as ProjectPhaseState;
          return (
            <li
              key={phase.id}
              className="bg-bg-2 border border-line p-4 flex items-center justify-between gap-4"
            >
              <div className="flex flex-col">
                <span className="text-ink font-display tracking-wider">{phase.name}</span>
                <span className="text-ink-dim text-sm font-mono">{ps}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => movePhase(index, -1)}
                  disabled={index === 0}
                >
                  Up
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => movePhase(index, 1)}
                  disabled={index === phases.length - 1}
                >
                  Down
                </Button>
                {PHASE_TARGETS
                  .filter((to) => to !== ps && canTransition(PROJECT_PHASE_FSM, ps, to))
                  .map((to) => (
                    <Button
                      key={to}
                      variant="secondary"
                      onClick={() =>
                        transitionPhase.mutate({ phaseId: phase.id, body: { to } })
                      }
                    >
                      {to}
                    </Button>
                  ))}
              </div>
            </li>
          );
        })}
      </ol>

      <form onSubmit={onAddPhase} className="flex gap-3 items-end">
        <TextInput
          label="New phase name"
          value={phaseName}
          onChange={(e) => setPhaseName(e.target.value)}
          required
        />
        <Button type="submit">Add phase</Button>
      </form>
    </section>
  );
}
