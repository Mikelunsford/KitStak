// ShiftsListPage. KitForce schedule view. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + FilterBar + Select + DataTable +
// StatusBadge + Pagination replace the hand-rolled header, filter selects,
// table, and raw status pill. Shifts have no dedicated create page, so the
// inline create form (with its kit-Select member and team pickers) stays.
// Behavior preserved: the ?status= deep-link seeds the filter, datetime-local
// values are coerced to ISO before posting, and the onboarding ListEmptyState
// shows only when unfiltered.

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, type FilterChip } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { TextInput } from '@/components/ui/TextInput';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import {
  useShiftsList,
  useMembersList,
  useTeamsList,
  useCreateShift,
} from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatDateTimeMedium } from '@/lib/dates';
import type { Shift, ShiftCreate, ShiftStatus } from '@/lib/types/kitforce';

const PAGE_SIZE = 50;

type StatusFilter = ShiftStatus | 'all';

const ALLOWED_SHIFT_STATUSES = new Set<string>([
  'scheduled',
  'started',
  'completed',
  'cancelled',
]);

const SHIFT_STATUSES: ShiftStatus[] = [
  'scheduled',
  'started',
  'completed',
  'cancelled',
];

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
  const [page, setPage] = useState(0);

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

  function applyStatus(next: StatusFilter) {
    setStatus(next);
    setPage(0);
  }

  function applyMember(next: string) {
    setMemberFilter(next);
    setPage(0);
  }

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

  const columns: ReadonlyArray<DataColumn<Shift>> = [
    {
      key: 'shift',
      header: 'Shift',
      cellClassName: 'tabular-nums',
      render: (s) => (
        <Link to={`/kitforce/shifts/${s.id}`} className={LINK_CLASS}>
          {s.shift_number ?? '·'}
        </Link>
      ),
    },
    {
      key: 'member',
      header: 'Member',
      cellClassName: 'text-ink',
      render: (s) => memberName[s.member_id] ?? s.member_id.slice(0, 8),
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => <StatusBadge status={s.status} />,
    },
    {
      key: 'start',
      header: 'Start',
      cellClassName: 'text-ink-dim',
      render: (s) => formatDateTimeMedium(s.scheduled_start_at),
    },
    {
      key: 'end',
      header: 'End',
      cellClassName: 'text-ink-dim',
      render: (s) => formatDateTimeMedium(s.scheduled_end_at),
    },
  ];

  const rows = shifts.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !shifts.isLoading && !shifts.error
      ? `${totalCount} ${totalCount === 1 ? 'shift' : 'shifts'}`
      : undefined;

  const chips: FilterChip[] = [];
  if (status !== 'all') {
    chips.push({
      key: 'status',
      label: `Status: ${humaniseStatus(status)}`,
      onClear: () => applyStatus('all'),
    });
  }
  if (memberFilter) {
    chips.push({
      key: 'member',
      label: `Member: ${memberName[memberFilter] ?? memberFilter}`,
      onClear: () => applyMember(''),
    });
  }

  const showOnboardingEmpty =
    !shifts.isLoading &&
    !shifts.error &&
    totalCount === 0 &&
    status === 'all' &&
    !memberFilter;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="KitForce / Schedule" title="Shifts" meta={meta} />

      {canCreate ? (
        <form
          onSubmit={onSubmit}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end border border-line bg-bg-2 p-4"
        >
          <label className="flex flex-col gap-1">
            <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">
              Member
            </span>
            <Select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              disabled={members.isLoading}
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
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">
              Team (optional)
            </span>
            <Select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
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
          <Button
            type="submit"
            disabled={!memberId || !startAt || !endAt || create.isPending}
          >
            {create.isPending ? 'Saving.' : 'Add shift'}
          </Button>
        </form>
      ) : null}
      {create.error ? (
        <p className="text-accent font-sans text-sm">
          {create.error instanceof Error ? create.error.message : 'Create failed.'}
        </p>
      ) : null}

      <FilterBar chips={chips}>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">
            Status
          </span>
          <Select
            value={status}
            onChange={(e) => applyStatus(e.target.value as StatusFilter)}
            aria-label="Filter by status"
          >
            <option value="all">All</option>
            {SHIFT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">
            Member
          </span>
          <Select
            value={memberFilter}
            onChange={(e) => applyMember(e.target.value)}
            disabled={members.isLoading}
            aria-label="Filter by member"
          >
            <option value="">All members</option>
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      {shifts.error ? (
        <p className="text-accent font-sans text-sm">
          {shifts.error instanceof Error
            ? shifts.error.message
            : 'Failed to load shifts.'}
        </p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="shift"
          explainer="Shifts roster a member onto a block of time. Place one to start running the schedule."
          addLabel="Add shift"
          addTo="/kitforce/shifts"
          canAdd={false}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={pageRows}
            getRowKey={(s) => s.id}
            loading={shifts.isLoading}
            empty="No shifts match the current filters."
          />
          {totalCount > PAGE_SIZE ? (
            <Pagination
              page={page}
              totalCount={totalCount}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
