import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import {
  useAssignment,
  useMembersList,
  useAssignAssignment,
  useStartAssignment,
  useCompleteAssignment,
  useCancelAssignment,
} from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { defaultStateLabel } from '@/components/shell/auditStateFormatters';
import { formatDateTimeMedium } from '@/lib/dates';

/**
 * AssignmentDetailPage. Pillar 4. Mirrors FulfillmentDetailPage shape.
 *
 * State machine: open -> assigned -> in_progress -> done;
 * open|assigned|in_progress -> cancelled; done terminal. Each forward
 * transition gates on its own capability (assign/start/complete/cancel).
 *
 * The job link is polymorphic: job_type plus job_id, both null or both set. We
 * render the type label and the truncated id; resolving the cross-pillar target
 * name is out of scope for this surface.
 */
export function AssignmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const assignmentId = id ?? '';

  const assignment = useAssignment(id);
  const members = useMembersList();
  const assign = useAssignAssignment(assignmentId);
  const start = useStartAssignment(assignmentId);
  const complete = useCompleteAssignment(assignmentId);
  const cancel = useCancelAssignment(assignmentId);

  const caps = useVioCapabilities();

  // When an assignment was created Unassigned, the operator must pick a member
  // before the Assign transition can advance. The server requires a member_id
  // (or an existing one on the row); without this picker an Unassigned
  // assignment could never leave the open state from its detail page.
  const [assignMemberId, setAssignMemberId] = useState('');

  const memberName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members.data ?? []) map[m.id] = m.display_name;
    return map;
  }, [members.data]);

  if (assignment.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (assignment.error || !assignment.data) {
    return <p className="px-8 py-12 text-accent">Assignment not found.</p>;
  }
  const d = assignment.data;

  const isOpen = d.status === 'open';
  const isAssigned = d.status === 'assigned';
  const isInProgress = d.status === 'in_progress';
  const canCancel = isOpen || isAssigned || isInProgress;

  async function onComplete() {
    if (!(await destructiveConfirm({
      action: 'Complete this assignment',
      consequence: 'The assignment moves to done and can no longer be started or edited.',
      irreversible: true,
    }))) return;
    complete.mutate({});
  }

  async function onCancel() {
    if (!(await destructiveConfirm({
      action: 'Cancel this assignment',
      consequence: 'The assignment will move to cancelled and stop appearing in the active work queue.',
    }))) return;
    cancel.mutate({});
  }

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'KitForce', to: '/kitforce/members' },
          { label: 'Assignments', to: '/kitforce/assignments' },
          { label: d.assignment_number ?? d.title },
        ]}
      />
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">{d.title}</h1>
        <span className="inline-block px-3 py-1 border border-line text-xs font-mono uppercase text-ink-dim">
          {defaultStateLabel(d.status)}
        </span>
      </header>

      <div className="flex gap-2 flex-wrap">
        {isOpen && caps.can('kitforce.assignment.assign') && (
          <div className="flex items-center gap-2 flex-wrap">
            {!d.member_id && (
              <select
                value={assignMemberId}
                onChange={(e) => setAssignMemberId(e.target.value)}
                disabled={members.isLoading}
                className="bg-bg-2 border border-line text-ink px-3 py-1 text-xs font-sans focus:outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="">Select a member</option>
                {(members.data ?? [])
                  .filter((m) => m.status === 'active')
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
              </select>
            )}
            <button
              onClick={() =>
                assign.mutate(
                  d.member_id ? {} : { member_id: assignMemberId },
                )
              }
              disabled={assign.isPending || (!d.member_id && !assignMemberId)}
              className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2 disabled:opacity-50"
            >
              Assign
            </button>
          </div>
        )}
        {isAssigned && caps.can('kitforce.assignment.start') && (
          <button
            onClick={() => start.mutate({})}
            disabled={start.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Start
          </button>
        )}
        {isInProgress && caps.can('kitforce.assignment.complete') && (
          <button
            onClick={onComplete}
            disabled={complete.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Complete
          </button>
        )}
        {canCancel && caps.can('kitforce.assignment.cancel') && (
          <button
            onClick={onCancel}
            disabled={cancel.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Cancel assignment
          </button>
        )}
      </div>
      {assign.error ? (
        <p className="font-sans text-sm text-accent">
          {assign.error instanceof Error ? assign.error.message : 'Assign failed.'}
        </p>
      ) : null}
      {start.error ? (
        <p className="font-sans text-sm text-accent">
          {start.error instanceof Error ? start.error.message : 'Start failed.'}
        </p>
      ) : null}
      {complete.error ? (
        <p className="font-sans text-sm text-accent">
          {complete.error instanceof Error ? complete.error.message : 'Complete failed.'}
        </p>
      ) : null}
      {cancel.error ? (
        <p className="font-sans text-sm text-accent">
          {cancel.error instanceof Error ? cancel.error.message : 'Cancel failed.'}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Assignment number</dt>
        <dd className="text-ink font-mono">{d.assignment_number ?? 'None'}</dd>
        <dt className="text-ink-dim">Member</dt>
        <dd className="text-ink">
          {d.member_id ? memberName[d.member_id] ?? d.member_id.slice(0, 8) : 'Unassigned'}
        </dd>
        <dt className="text-ink-dim">Shift</dt>
        <dd className="text-ink">{d.shift_id ? d.shift_id.slice(0, 8) : 'None'}</dd>
        <dt className="text-ink-dim">Job link</dt>
        <dd className="text-ink">
          {d.job_type && d.job_id ? `${d.job_type} ${d.job_id.slice(0, 8)}` : 'None'}
        </dd>
        <dt className="text-ink-dim">Planned minutes</dt>
        <dd className="text-ink font-mono">{d.planned_minutes ?? 'None'}</dd>
        <dt className="text-ink-dim">Started</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.started_at)}</dd>
        <dt className="text-ink-dim">Completed</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.completed_at)}</dd>
        <dt className="text-ink-dim">Cancelled</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.cancelled_at)}</dd>
        <dt className="text-ink-dim">Notes</dt>
        <dd className="text-ink whitespace-pre-wrap">{d.notes ?? ''}</dd>
      </dl>

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="work_assignment" entityId={id ?? null} />
      </section>
    </section>
  );
}
