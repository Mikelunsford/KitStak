// RecurringBillingControl. The operator surface for ADR 0005 Phase 2: start,
// pause, resume, or end a project's monthly recurring-billing schedule. The
// migration 0138 generator no-ops until a schedule row exists, so this control
// is what turns recurring billing on. It lives on the project detail Invoices
// tab because a schedule drafts invoices.
//
// Write actions are hidden unless the role carries invoices.write (button-hiding
// mirror; the edge requireCap is the authority). A project has at most one live
// schedule, so the control shows a single off / active / paused state.

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import {
  useCreateRecurringSchedule,
  useEndRecurringSchedule,
  usePauseRecurringSchedule,
  useRecurringSchedules,
  useResumeRecurringSchedule,
} from '@/lib/hooks/useRecurringSchedules';
import { resolveRecurringBillingState } from './recurringBillingState';

interface RecurringBillingControlProps {
  projectId: string;
  /** Whether the project carries any monthly lines; drives a soft no-op hint. */
  hasMonthlyLines: boolean;
}

export function RecurringBillingControl({
  projectId,
  hasMonthlyLines,
}: RecurringBillingControlProps) {
  const { can } = useCapabilities();
  const canWrite = can('invoices.write');

  const schedules = useRecurringSchedules(projectId);
  const create = useCreateRecurringSchedule(projectId);
  const pause = usePauseRecurringSchedule(projectId);
  const resume = useResumeRecurringSchedule(projectId);
  const end = useEndRecurringSchedule(projectId);

  const [startDate, setStartDate] = useState('');

  const busy =
    create.isPending || pause.isPending || resume.isPending || end.isPending;
  const mutationError =
    create.error || pause.error || resume.error || end.error;

  if (schedules.isLoading) {
    return <p className="text-ink-dim text-sm">Loading recurring billing.</p>;
  }

  const { mode, schedule } = resolveRecurringBillingState(schedules.data ?? []);

  const onStart = () => {
    create.mutate(
      {
        project_id: projectId,
        ...(startDate.trim() ? { next_run_on: startDate.trim() } : {}),
      },
      { onSuccess: () => setStartDate('') },
    );
  };

  const onEnd = async () => {
    if (!schedule) return;
    if (
      !(await destructiveConfirm({
        action: 'End recurring billing',
        consequence:
          'No more invoices will be generated for this project. You can start a new schedule later.',
      }))
    ) {
      return;
    }
    end.mutate(schedule.id);
  };

  const statusLabel =
    mode === 'active' ? 'On' : mode === 'paused' ? 'Paused' : 'Off';

  return (
    <section
      className="border border-line p-4 mb-4"
      data-testid="recurring-billing-control"
    >
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-display tracking-wider text-ink">RECURRING BILLING</h3>
        <span className="text-ink-dim text-sm">{statusLabel}</span>
      </div>
      <p className="text-ink-dim text-sm mb-3">
        Drafts a monthly invoice from this project&apos;s recurring (monthly)
        lines. The daily generator bills on the schedule date, then advances one
        month.
      </p>

      {mode === 'none' && (
        <div className="flex flex-col gap-2">
          {!hasMonthlyLines && (
            <p className="text-ink-dim text-sm">
              This project has no monthly lines yet, so nothing will be billed
              until you add one (set a line&apos;s billing interval to Monthly).
            </p>
          )}
          {canWrite ? (
            <div className="flex flex-wrap items-end gap-3">
              <TextInput
                label="First invoice date (optional)"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <Button onClick={onStart} disabled={busy}>
                {create.isPending ? 'Starting.' : 'Start monthly billing'}
              </Button>
            </div>
          ) : (
            <p className="text-ink-dim text-sm">
              You do not have permission to manage recurring billing.
            </p>
          )}
        </div>
      )}

      {mode !== 'none' && schedule && (
        <div className="flex flex-col gap-2">
          <p className="text-ink text-sm tabular-nums">
            {mode === 'active'
              ? `Next invoice ${schedule.next_run_on}`
              : 'Paused. No invoices will be generated until you resume.'}
          </p>
          {!hasMonthlyLines && (
            <p className="text-ink-dim text-sm">
              No monthly lines on this project yet, so each run bills nothing.
            </p>
          )}
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              {mode === 'active' && (
                <Button
                  variant="secondary"
                  onClick={() => pause.mutate(schedule.id)}
                  disabled={busy}
                >
                  {pause.isPending ? 'Pausing.' : 'Pause'}
                </Button>
              )}
              {mode === 'paused' && (
                <Button
                  variant="secondary"
                  onClick={() => resume.mutate(schedule.id)}
                  disabled={busy}
                >
                  {resume.isPending ? 'Resuming.' : 'Resume'}
                </Button>
              )}
              <Button variant="ghost" onClick={onEnd} disabled={busy}>
                {end.isPending ? 'Ending.' : 'End'}
              </Button>
            </div>
          )}
        </div>
      )}

      {mutationError && (
        <p className="font-sans text-sm text-accent mt-2">
          {mutationError instanceof Error
            ? mutationError.message
            : 'Recurring billing action failed.'}
        </p>
      )}
    </section>
  );
}
