import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { useAssignment, useUpdateAssignment } from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { WorkAssignmentPatch } from '@/lib/types/kitforce';

/**
 * AssignmentEditPage. Pillar 4. F-Wave10-KITFORCE-ASSIGNMENT-EDIT-01.
 *
 * The assignment detail page exposed FSM transitions (assign/start/complete/
 * cancel) but no way to correct the title, planned_minutes, or notes after
 * creation. This page mirrors MemberEditPage but for work_assignments.
 *
 * Status and FSM fields (member_id, shift_id, job_type, job_id) are not editable
 * here: member is set via the Assign transition; job link is structural metadata.
 * assignment_number is chassis-assigned and never user-editable.
 *
 * Capability gate: kitforce.assignment.update.
 */
export function AssignmentEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const assignmentId = id ?? '';

  const assignment = useAssignment(id);
  const update = useUpdateAssignment(assignmentId);
  const caps = useVioCapabilities();

  const canUpdate = caps.can('kitforce.assignment.update');

  const d = assignment.data;

  // Local edit state; null means "not yet touched, read from loaded row".
  const [title, setTitle] = useState<string | null>(null);
  const [plannedMinutes, setPlannedMinutes] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  if (assignment.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (assignment.error || !d) {
    return <p className="px-8 py-12 text-accent">Assignment not found.</p>;
  }

  const vTitle = title ?? d.title;
  const vPlannedMinutes =
    plannedMinutes ?? (d.planned_minutes != null ? String(d.planned_minutes) : '');
  const vNotes = notes ?? d.notes ?? '';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canUpdate) return;
    const body: WorkAssignmentPatch = {
      title: vTitle.trim(),
      notes: vNotes.trim() ? vNotes.trim() : null,
    };
    const parsed = parseFloat(vPlannedMinutes);
    body.planned_minutes = vPlannedMinutes.trim() && !Number.isNaN(parsed) ? parsed : null;
    update.mutate(body, {
      onSuccess: () => navigate(`/kitforce/assignments/${assignmentId}`),
    });
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader title="Edit assignment" />
      {!canUpdate ? (
        <p className="text-accent font-sans text-sm">
          You do not have permission to edit assignments.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Title"
          value={vTitle}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <TextInput
          label="Planned minutes (optional, e.g. 120)"
          inputMode="decimal"
          value={vPlannedMinutes}
          onChange={(e) => setPlannedMinutes(e.target.value)}
        />

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes (optional)
          </span>
          <textarea
            value={vNotes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        {update.error ? (
          <p className="text-accent font-sans text-sm">
            {update.error instanceof Error ? update.error.message : 'Save failed.'}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={!canUpdate || !vTitle.trim() || update.isPending}>
            {update.isPending ? 'Saving.' : 'Save changes'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(`/kitforce/assignments/${assignmentId}`)}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
