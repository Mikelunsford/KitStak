// ShiftDetailPage. KitForce schedule. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader (status as a StatusBadge in the meta slot) +
// DetailLayout (HISTORY in the rail) replace the hand-rolled header, raw status
// pill, and bottom history section. FSM transition controls move to the kit
// Button (ghost for the destructive cancel, secondary for start/complete/edit).
// KitForce FSMs are not registered in STATE_STEPPER_PATHS, so there is no
// StateStepper (matching Co-Pack). The inline edit-while-scheduled form (with
// its kit-Select team picker), the start/complete/cancel destructiveConfirms,
// the edit-only-while-scheduled rule, and the cap gates are preserved verbatim.

import { useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TextInput } from '@/components/ui/TextInput';
import {
  useShift,
  useMembersList,
  useTeamsList,
  useUpdateShift,
  useStartShift,
  useCompleteShift,
  useCancelShift,
} from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { formatDateTimeMedium } from '@/lib/dates';
import type { ShiftPatch } from '@/lib/types/kitforce';

function localToIso(value: string): string | null {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

// ISO -> "YYYY-MM-DDTHH:mm" in local time for a datetime-local input.
function isoToLocalInput(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function ShiftDetailPage() {
  const { id } = useParams<{ id: string }>();
  const shiftId = id ?? '';

  const shift = useShift(id);
  const members = useMembersList();
  const teams = useTeamsList();
  const updateShift = useUpdateShift(shiftId);
  const start = useStartShift(shiftId);
  const complete = useCompleteShift(shiftId);
  const cancel = useCancelShift(shiftId);

  const caps = useVioCapabilities();
  const canUpdate = caps.can('kitforce.shift.update');

  const [isEditing, setIsEditing] = useState(false);
  const [editStart, setEditStart] = useState<string | null>(null);
  const [editEnd, setEditEnd] = useState<string | null>(null);
  const [editTeam, setEditTeam] = useState<string | null>(null);

  const memberName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members.data ?? []) map[m.id] = m.display_name;
    return map;
  }, [members.data]);

  const teamName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of teams.data ?? []) map[t.id] = t.name;
    return map;
  }, [teams.data]);

  if (shift.isLoading) {
    return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  }
  if (shift.error || !shift.data) {
    return <p className="px-8 py-12 text-accent">Shift not found.</p>;
  }
  const d = shift.data;

  const isScheduled = d.status === 'scheduled';
  const isStarted = d.status === 'started';
  const canCancel = isScheduled || isStarted;

  // Shifts are editable only while scheduled (the spec's "edit only while
  // scheduled" rule). Effective form values fall back to the loaded row.
  const vStart = editStart ?? isoToLocalInput(d.scheduled_start_at);
  const vEnd = editEnd ?? isoToLocalInput(d.scheduled_end_at);
  const vTeam = editTeam ?? (d.team_id ?? '');

  function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    const startIso = localToIso(vStart);
    const endIso = localToIso(vEnd);
    if (!startIso || !endIso) return;
    const body: ShiftPatch = {
      scheduled_start_at: startIso,
      scheduled_end_at: endIso,
      team_id: vTeam ? vTeam : null,
    };
    updateShift.mutate(body, { onSuccess: () => setIsEditing(false) });
  }

  async function onComplete() {
    if (
      !(await destructiveConfirm({
        action: 'Complete this shift',
        consequence:
          'The shift moves to completed and can no longer be started or edited.',
        irreversible: true,
      }))
    )
      return;
    complete.mutate({});
  }

  async function onCancel() {
    if (
      !(await destructiveConfirm({
        action: 'Cancel this shift',
        consequence:
          'The shift will move to cancelled and stop appearing in active schedules.',
      }))
    )
      return;
    cancel.mutate({});
  }

  const titleId =
    d.shift_number ?? memberName[d.member_id] ?? d.member_id.slice(0, 8);

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'KitForce', to: '/kitforce/members' },
          { label: 'Schedule', to: '/kitforce/shifts' },
          { label: titleId },
        ]}
      />
      <PageHeader
        title={`Shift ${titleId}`}
        meta={<StatusBadge status={d.status} />}
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
              HISTORY
            </h2>
            <AuditTimeline entityType="shift" entityId={id ?? null} />
          </section>
        }
      >
        <div className="flex gap-2 flex-wrap">
          {isScheduled && caps.can('kitforce.shift.start') && (
            <Button
              variant="secondary"
              onClick={() => start.mutate({})}
              disabled={start.isPending}
            >
              Start
            </Button>
          )}
          {isStarted && caps.can('kitforce.shift.complete') && (
            <Button
              variant="secondary"
              onClick={onComplete}
              disabled={complete.isPending}
            >
              Complete
            </Button>
          )}
          {canCancel && caps.can('kitforce.shift.cancel') && (
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={cancel.isPending}
            >
              Cancel shift
            </Button>
          )}
          {isScheduled && canUpdate && !isEditing && (
            <Button variant="secondary" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
          )}
        </div>

        {isEditing ? (
          <form
            onSubmit={onSaveEdit}
            className="flex flex-col gap-4 border border-line bg-bg-2 p-4"
          >
            <h2 className="font-display tracking-wider text-ink">EDIT SHIFT</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TextInput
                label="Scheduled start"
                type="datetime-local"
                value={vStart}
                onChange={(e) => setEditStart(e.target.value)}
              />
              <TextInput
                label="Scheduled end"
                type="datetime-local"
                value={vEnd}
                onChange={(e) => setEditEnd(e.target.value)}
              />
              <label className="flex flex-col gap-1">
                <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">
                  Team (optional)
                </span>
                <Select
                  value={vTeam}
                  onChange={(e) => setEditTeam(e.target.value)}
                  disabled={teams.isLoading}
                >
                  <option value="">No team</option>
                  {(teams.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            {updateShift.error ? (
              <p className="text-accent font-sans text-sm">
                {updateShift.error instanceof Error
                  ? updateShift.error.message
                  : 'Save failed.'}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={!vStart || !vEnd || updateShift.isPending}
              >
                {updateShift.isPending ? 'Saving.' : 'Save changes'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setIsEditing(false);
                  setEditStart(null);
                  setEditEnd(null);
                  setEditTeam(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
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
          <dt className="text-ink-dim">Shift number</dt>
          <dd className="text-ink tabular-nums">{d.shift_number ?? '·'}</dd>
          <dt className="text-ink-dim">Member</dt>
          <dd className="text-ink">
            {memberName[d.member_id] ?? d.member_id.slice(0, 8)}
          </dd>
          <dt className="text-ink-dim">Team</dt>
          <dd className="text-ink">
            {d.team_id
              ? teamName[d.team_id] ?? d.team_id.slice(0, 8)
              : 'None'}
          </dd>
          <dt className="text-ink-dim">Scheduled start</dt>
          <dd className="text-ink">
            {formatDateTimeMedium(d.scheduled_start_at)}
          </dd>
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
      </DetailLayout>
    </section>
  );
}
