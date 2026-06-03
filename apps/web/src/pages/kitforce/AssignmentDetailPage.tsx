// AssignmentDetailPage. KitForce work queue. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader (status as a StatusBadge in the meta slot) +
// DetailLayout (HISTORY in the rail) replace the hand-rolled header, raw status
// pill, and bottom history section. FSM transition controls move to the kit
// Button (ghost for the destructive cancel, secondary for the forward moves and
// Edit). KitForce FSMs are not registered in STATE_STEPPER_PATHS, so there is no
// StateStepper (matching Co-Pack). The Assign inline member-picker (an
// Unassigned assignment must pick a member before it can leave open), the
// complete/cancel destructiveConfirms, the polymorphic job-link rendering, and
// the cap gates are preserved verbatim.

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
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
import { formatDateTimeMedium } from '@/lib/dates';

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

  if (assignment.isLoading) {
    return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  }
  if (assignment.error || !assignment.data) {
    return <p className="px-8 py-12 text-accent">Assignment not found.</p>;
  }
  const d = assignment.data;

  const isOpen = d.status === 'open';
  const isAssigned = d.status === 'assigned';
  const isInProgress = d.status === 'in_progress';
  const canCancel = isOpen || isAssigned || isInProgress;

  async function onComplete() {
    if (
      !(await destructiveConfirm({
        action: 'Complete this assignment',
        consequence:
          'The assignment moves to done and can no longer be started or edited.',
        irreversible: true,
      }))
    )
      return;
    complete.mutate({});
  }

  async function onCancel() {
    if (
      !(await destructiveConfirm({
        action: 'Cancel this assignment',
        consequence:
          'The assignment will move to cancelled and stop appearing in the active work queue.',
      }))
    )
      return;
    cancel.mutate({});
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'KitForce', to: '/kitforce/members' },
          { label: 'Assignments', to: '/kitforce/assignments' },
          { label: d.assignment_number ?? d.title },
        ]}
      />
      <PageHeader title={d.title} meta={<StatusBadge status={d.status} />} />

      <DetailLayout
        rail={
          <section>
            <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
              HISTORY
            </h2>
            <AuditTimeline entityType="work_assignment" entityId={id ?? null} />
          </section>
        }
      >
        <div className="flex gap-2 flex-wrap items-center">
          {caps.can('kitforce.assignment.update') &&
            d.status !== 'done' &&
            d.status !== 'cancelled' && (
              <Link to={`/kitforce/assignments/${assignmentId}/edit`}>
                <Button variant="secondary">Edit</Button>
              </Link>
            )}
          {isOpen && caps.can('kitforce.assignment.assign') && (
            <div className="flex items-center gap-2 flex-wrap">
              {!d.member_id && (
                <Select
                  value={assignMemberId}
                  onChange={(e) => setAssignMemberId(e.target.value)}
                  disabled={members.isLoading}
                  aria-label="Member to assign"
                >
                  <option value="">Select a member</option>
                  {(members.data ?? [])
                    .filter((m) => m.status === 'active')
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name}
                      </option>
                    ))}
                </Select>
              )}
              <Button
                variant="secondary"
                onClick={() =>
                  assign.mutate(d.member_id ? {} : { member_id: assignMemberId })
                }
                disabled={assign.isPending || (!d.member_id && !assignMemberId)}
              >
                Assign
              </Button>
            </div>
          )}
          {isAssigned && caps.can('kitforce.assignment.start') && (
            <Button
              variant="secondary"
              onClick={() => start.mutate({})}
              disabled={start.isPending}
            >
              Start
            </Button>
          )}
          {isInProgress && caps.can('kitforce.assignment.complete') && (
            <Button
              variant="secondary"
              onClick={onComplete}
              disabled={complete.isPending}
            >
              Complete
            </Button>
          )}
          {canCancel && caps.can('kitforce.assignment.cancel') && (
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={cancel.isPending}
            >
              Cancel assignment
            </Button>
          )}
        </div>
        {assign.error ? (
          <p className="font-sans text-sm text-accent">
            {assign.error instanceof Error
              ? assign.error.message
              : 'Assign failed.'}
          </p>
        ) : null}
        {start.error ? (
          <p className="font-sans text-sm text-accent">
            {start.error instanceof Error ? start.error.message : 'Start failed.'}
          </p>
        ) : null}
        {complete.error ? (
          <p className="font-sans text-sm text-accent">
            {complete.error instanceof Error
              ? complete.error.message
              : 'Complete failed.'}
          </p>
        ) : null}
        {cancel.error ? (
          <p className="font-sans text-sm text-accent">
            {cancel.error instanceof Error
              ? cancel.error.message
              : 'Cancel failed.'}
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
          <dt className="text-ink-dim">Assignment number</dt>
          <dd className="text-ink font-mono">{d.assignment_number ?? 'None'}</dd>
          <dt className="text-ink-dim">Member</dt>
          <dd className="text-ink">
            {d.member_id
              ? memberName[d.member_id] ?? d.member_id.slice(0, 8)
              : 'Unassigned'}
          </dd>
          <dt className="text-ink-dim">Shift</dt>
          <dd className="text-ink">
            {d.shift_id ? d.shift_id.slice(0, 8) : 'None'}
          </dd>
          <dt className="text-ink-dim">Job link</dt>
          <dd className="text-ink">
            {d.job_type && d.job_id
              ? `${d.job_type} ${d.job_id.slice(0, 8)}`
              : 'None'}
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
      </DetailLayout>
    </section>
  );
}
