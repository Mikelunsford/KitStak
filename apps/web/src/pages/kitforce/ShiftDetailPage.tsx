import { useMemo } from 'react';
import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import {
  useShift,
  useMembersList,
  useStartShift,
  useCompleteShift,
  useCancelShift,
} from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { defaultStateLabel } from '@/components/shell/auditStateFormatters';
import { formatDateTimeMedium } from '@/lib/dates';

/**
 * ShiftDetailPage. Pillar 4. Mirrors FulfillmentDetailPage shape.
 *
 * State machine: scheduled -> started -> completed;
 * scheduled|started -> cancelled; completed terminal. Each forward transition
 * gates on its own capability (start/complete/cancel). Status renders as a
 * simple inline pill (KitForce FSMs are not registered in STATE_STEPPER_PATHS).
 */
export function ShiftDetailPage() {
  const { id } = useParams<{ id: string }>();
  const shiftId = id ?? '';

  const shift = useShift(id);
  const members = useMembersList();
  const start = useStartShift(shiftId);
  const complete = useCompleteShift(shiftId);
  const cancel = useCancelShift(shiftId);

  const caps = useVioCapabilities();

  const memberName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members.data ?? []) map[m.id] = m.display_name;
    return map;
  }, [members.data]);

  if (shift.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (shift.error || !shift.data) {
    return <p className="px-8 py-12 text-accent">Shift not found.</p>;
  }
  const d = shift.data;

  const isScheduled = d.status === 'scheduled';
  const isStarted = d.status === 'started';
  const canCancel = isScheduled || isStarted;

  function onComplete() {
    if (!destructiveConfirm({
      action: 'Complete this shift',
      consequence: 'The shift moves to completed and can no longer be started or edited.',
      irreversible: true,
    })) return;
    complete.mutate({});
  }

  function onCancel() {
    if (!destructiveConfirm({
      action: 'Cancel this shift',
      consequence: 'The shift will move to cancelled and stop appearing in active schedules.',
    })) return;
    cancel.mutate({});
  }

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'KitForce', to: '/kitforce/members' },
          { label: 'Schedule', to: '/kitforce/shifts' },
          { label: memberName[d.member_id] ?? d.member_id.slice(0, 8) },
        ]}
      />
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          SHIFT {memberName[d.member_id] ?? d.member_id.slice(0, 8)}
        </h1>
        <span className="inline-block px-3 py-1 border border-line text-xs font-mono uppercase text-ink-dim">
          {defaultStateLabel(d.status)}
        </span>
      </header>

      <div className="flex gap-2 flex-wrap">
        {isScheduled && caps.can('kitforce.shift.start') && (
          <button
            onClick={() => start.mutate({})}
            disabled={start.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Start
          </button>
        )}
        {isStarted && caps.can('kitforce.shift.complete') && (
          <button
            onClick={onComplete}
            disabled={complete.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Complete
          </button>
        )}
        {canCancel && caps.can('kitforce.shift.cancel') && (
          <button
            onClick={onCancel}
            disabled={cancel.isPending}
            className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2"
          >
            Cancel shift
          </button>
        )}
      </div>
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
        <dt className="text-ink-dim">Member</dt>
        <dd className="text-ink">{memberName[d.member_id] ?? d.member_id.slice(0, 8)}</dd>
        <dt className="text-ink-dim">Team</dt>
        <dd className="text-ink">{d.team_id ? d.team_id.slice(0, 8) : 'None'}</dd>
        <dt className="text-ink-dim">Scheduled start</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.scheduled_start_at)}</dd>
        <dt className="text-ink-dim">Scheduled end</dt>
        <dd className="text-ink">{formatDateTimeMedium(d.scheduled_end_at)}</dd>
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
        <AuditTimeline entityType="shift" entityId={id ?? null} />
      </section>
    </section>
  );
}
