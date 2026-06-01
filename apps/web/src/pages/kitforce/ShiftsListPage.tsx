import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import {
  useShiftsList,
  useMembersList,
  useTeamsList,
  useCreateShift,
} from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatDateTimeMedium } from '@/lib/dates';
import type { ShiftCreate, ShiftStatus } from '@/lib/types/kitforce';

/**
 * ShiftsListPage. Pillar 4 schedule view. Mirrors SalesOrdersListPage with an
 * inline create form (shifts have no dedicated create page). Supports ?status=
 * deep-links. Create gates on kitforce.shift.create. datetime-local values are
 * coerced to ISO before posting so the Iso zod schema accepts them.
 */
type StatusFilter = ShiftStatus | 'all';

const ALLOWED_SHIFT_STATUSES = new Set<string>([
  'scheduled',
  'started',
  'completed',
  'cancelled',
]);

function parseShiftStatusParam(raw: string | null): StatusFilter {
  if (raw && ALLOWED_SHIFT_STATUSES.has(raw)) {
    return raw as ShiftStatus;
  }
  return 'all';
}

function localToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function ShiftsListPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseShiftStatusParam(searchParams.get('status')),
  );
  const [memberFilter, setMemberFilter] = useState<string>('');

  const filters = useMemo(() => {
    const f: { status?: StatusFilter; member_id?: string } = {};
    if (status !== 'all') f.status = status;
    if (memberFilter) f.member_id = memberFilter;
    return f;
  }, [status, memberFilter]);

  const shifts = useShiftsList(filters);
  const members = useMembersList();
  const teams = useTeamsList();
  const create = useCreateShift();
  const caps = useVioCapabilities();
  const canCreate = caps.can('kitforce.shift.create');

  const [memberId, setMemberId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');

  const memberName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members.data ?? []) map[m.id] = m.display_name;
    return map;
  }, [members.data]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate || !memberId) return;
    const startIso = localToIso(startAt);
    const endIso = localToIso(endAt);
    if (!startIso || !endIso) return;
    const body: ShiftCreate = {
      member_id: memberId,
      scheduled_start_at: startIso,
      scheduled_end_at: endIso,
    };
    if (teamId) body.team_id = teamId;
    create.mutate(body, {
      onSuccess: () => {
        setMemberId('');
        setTeamId('');
        setStartAt('');
        setEndAt('');
      },
    });
  }

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header>
        <h1 className="text-4xl font-display tracking-wide text-ink">SCHEDULE</h1>
      </header>

      {canCreate ? (
        <form
          onSubmit={onSubmit}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end border border-line bg-bg-2 p-4"
        >
          <label className="flex flex-col gap-1">
            <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Member</span>
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              disabled={members.isLoading}
              className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
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
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Team (optional)</span>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              disabled={teams.isLoading}
              className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
            >
              <option value="">No team</option>
              {(teams.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <TextInput
            label="Start"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
          />
          <TextInput
            label="End"
            type="datetime-local"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
          />
          <Button type="submit" disabled={!memberId || !startAt || !endAt || create.isPending}>
            {create.isPending ? 'Saving.' : 'Add shift'}
          </Button>
        </form>
      ) : null}
      {create.error ? (
        <p className="text-accent font-sans text-sm">
          {create.error instanceof Error ? create.error.message : 'Create failed.'}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent"
          >
            <option value="all">All</option>
            <option value="scheduled">Scheduled</option>
            <option value="started">Started</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Member</span>
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            disabled={members.isLoading}
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">All members</option>
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {shifts.isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {shifts.error ? (
        <p className="text-accent font-sans text-sm">
          {shifts.error instanceof Error ? shifts.error.message : 'Failed to load shifts.'}
        </p>
      ) : null}

      {!shifts.isLoading && (shifts.data ?? []).length === 0 && status === 'all' && !memberFilter ? (
        <ListEmptyState
          entity="shift"
          explainer="Shifts roster a member onto a block of time. Place one to start running the schedule."
          addLabel="Add shift"
          addTo="/kitforce/shifts"
          canAdd={false}
        />
      ) : (
        <table className="w-full border border-line text-sm font-sans">
          <thead className="bg-bg-2 text-left text-ink-dim">
            <tr>
              <th className="px-4 py-2">Shift</th>
              <th className="px-4 py-2">Member</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Start</th>
              <th className="px-4 py-2">End</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(shifts.data ?? []).length === 0 && !shifts.isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-ink-dim text-sm">
                  No shifts match the current filters.
                </td>
              </tr>
            ) : (
              (shifts.data ?? []).map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-4 py-2 font-mono">
                    <Link to={`/kitforce/shifts/${s.id}`} className="text-ink underline">
                      {s.shift_number ?? '·'}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-ink">
                    {memberName[s.member_id] ?? s.member_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-ink-dim">{formatDateTimeMedium(s.scheduled_start_at)}</td>
                  <td className="px-4 py-2 text-ink-dim">{formatDateTimeMedium(s.scheduled_end_at)}</td>
                  <td className="px-4 py-2">
                    <Link to={`/kitforce/shifts/${s.id}`} className="text-ink underline text-xs">
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
