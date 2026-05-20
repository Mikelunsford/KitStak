import { useEffect, useState } from 'react';
import {
  DndContext, KeyboardSensor, PointerSensor,
  closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import {
  PROJECT_PHASE_FSM, canTransition,
  type ProjectPhaseState,
} from '@/lib/workflow/sales';
import type { ProjectPhase } from '@/lib/types/sales';
import type { useReorderPhases, useTransitionPhase } from '@/lib/hooks/useProjects';

const PHASE_TARGETS: ProjectPhaseState[] = [
  'pending', 'active', 'completed', 'cancelled',
];

type ReorderMutation = ReturnType<typeof useReorderPhases>;
type TransitionPhaseMutation = ReturnType<typeof useTransitionPhase>;

export interface PhasesSectionProps {
  phases: ProjectPhase[];
  reorder: ReorderMutation;
  transitionPhase: TransitionPhaseMutation;
}

/**
 * Sortable phases list for ProjectDetailPage. Lazy-loaded at the route
 * boundary so that the dnd-kit chunk (`@dnd-kit/core` + `@dnd-kit/sortable`
 * + `@dnd-kit/utilities`, roughly 13 kB gzipped) does not land in the main
 * SPA index chunk. The static fallback (Up / Down buttons only) is rendered
 * by ProjectDetailPage's Suspense boundary while this chunk loads and stays
 * available as the keyboard / mouse-click accessibility baseline.
 *
 * Closes F-Wave2-DNDKIT-01.
 */
export function PhasesSection({
  phases, reorder, transitionPhase,
}: PhasesSectionProps) {
  // Optimistic local copy so the operator sees the new order the instant
  // the drop fires. React Query invalidation on reorder.onSuccess pulls the
  // canonical order back from the server; if mutate errors, we revert.
  const [optimistic, setOptimistic] = useState<ProjectPhase[]>(phases);

  // Re-sync when the server-side phases prop changes (post-mutation
  // invalidation, or external edits). This is the React Query truth.
  useEffect(() => {
    setOptimistic(phases);
  }, [phases]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Small activation distance so a plain click on the rest of the card
      // does not start a drag; only a deliberate pull on the handle does.
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const movePhase = (index: number, delta: number) => {
    const newIndex = index + delta;
    if (newIndex < 0 || newIndex >= optimistic.length) return;
    const next = arrayMove(optimistic, index, newIndex);
    setOptimistic(next);
    reorder.mutate(
      { phase_ids: next.map((p) => p.id) },
      {
        onError: () => {
          // Revert to the last known server truth.
          setOptimistic(phases);
        },
      },
    );
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = optimistic.findIndex((p) => p.id === active.id);
    const newIndex = optimistic.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(optimistic, oldIndex, newIndex);
    setOptimistic(next);
    reorder.mutate(
      { phase_ids: next.map((p) => p.id) },
      {
        onError: () => {
          setOptimistic(phases);
        },
      },
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={optimistic.map((p) => p.id)}
        strategy={verticalListSortingStrategy}
      >
        <ol className="flex flex-col gap-3">
          {optimistic.map((phase, index) => (
            <SortablePhaseRow
              key={phase.id}
              phase={phase}
              index={index}
              total={optimistic.length}
              transitionPhase={transitionPhase}
              onMoveUp={() => movePhase(index, -1)}
              onMoveDown={() => movePhase(index, 1)}
            />
          ))}
        </ol>
      </SortableContext>
      {reorder.isError && (
        <p className="font-sans text-sm text-accent mt-2">
          Reorder failed:{' '}
          {reorder.error instanceof Error ? reorder.error.message : 'unknown error'}
        </p>
      )}
    </DndContext>
  );
}

interface SortablePhaseRowProps {
  phase: ProjectPhase;
  index: number;
  total: number;
  transitionPhase: TransitionPhaseMutation;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function SortablePhaseRow({
  phase, index, total, transitionPhase, onMoveUp, onMoveDown,
}: SortablePhaseRowProps) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: phase.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    boxShadow: isDragging ? '0 6px 18px rgba(10, 22, 40, 0.35)' : undefined,
  };

  const ps = phase.state as ProjectPhaseState;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="bg-bg-2 border border-line p-4 flex items-center justify-between gap-4"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder phase ${phase.name}`}
          className="text-ink/60 hover:text-accent focus:text-accent focus:outline focus:outline-2 focus:outline-accent cursor-grab active:cursor-grabbing"
        >
          <GripVertical size={18} aria-hidden="true" />
        </button>
        <div className="flex flex-col">
          <span className="text-ink font-display tracking-wider">{phase.name}</span>
          <span className="text-ink-dim text-sm font-mono">{ps}</span>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button
          variant="ghost"
          onClick={onMoveUp}
          disabled={index === 0}
        >
          Up
        </Button>
        <Button
          variant="ghost"
          onClick={onMoveDown}
          disabled={index === total - 1}
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
}

export default PhasesSection;
