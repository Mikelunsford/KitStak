// AssignmentsListPage. KitForce work queue. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + FilterBar + Select + DataTable +
// StatusBadge + Pagination replace the hand-rolled header, filter selects,
// table, and raw status pill. Assignments have no dedicated create page, so the
// inline create form (with its kit-Select member picker) stays. Behavior
// preserved: the ?status= deep-link seeds the filter and the onboarding
// ListEmptyState shows only when unfiltered.

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
import {
  useAssignmentsList,
  useMembersList,
  useCreateAssignment,
} from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type {
  WorkAssignment,
  WorkAssignmentCreate,
  WorkAssignmentStatus,
} from '@/lib/types/kitforce';

const PAGE_SIZE = 50;

type StatusFilter = WorkAssignmentStatus | 'all';

const ALLOWED_ASSIGNMENT_STATUSES = new Set<string>([
  'open',
  'assigned',
  'in_progress',
  'done',
  'cancelled',
]);

const ASSIGNMENT_STATUSES: WorkAssignmentStatus[] = [
  'open',
  'assigned',
  'in_progress',
  'done',
  'cancelled',
];

function parseAssignmentStatusParam(raw: string | null): StatusFilter {
  if (raw && ALLOWED_ASSIGNMENT_STATUSES.has(raw)) {
    return raw as WorkAssignmentStatus;
  }
  return 'all';
}

export function AssignmentsListPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseAssignmentStatusParam(searchParams.get('status')),
  );
  const [memberFilter, setMemberFilter] = useState<string>('');
  const [page, setPage] = useState(0);

  const filters = useMemo(() => {
    const f: { status?: StatusFilter; member_id?: string } = {};
    if (status !== 'all') f.status = status;
    if (memberFilter) f.member_id = memberFilter;
    return f;
  }, [status, memberFilter]);

  const assignments = useAssignmentsList(filters);
  const members = useMembersList();
  const create = useCreateAssignment();
  const caps = useVioCapabilities();
  const canCreate = caps.can('kitforce.assignment.create');

  const [title, setTitle] = useState('');
  const [memberId, setMemberId] = useState('');
  const [plannedMinutes, setPlannedMinutes] = useState('');

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
    if (!canCreate || !title.trim()) return;
    const body: WorkAssignmentCreate = { title: title.trim() };
    if (memberId) body.member_id = memberId;
    if (plannedMinutes.trim() && /^\d+$/.test(plannedMinutes.trim())) {
      body.planned_minutes = Number(plannedMinutes.trim());
    }
    create.mutate(body, {
      onSuccess: () => {
        setTitle('');
        setMemberId('');
        setPlannedMinutes('');
      },
    });
  }

  const columns: ReadonlyArray<DataColumn<WorkAssignment>> = [
    {
      key: 'title',
      header: 'Title',
      render: (a) => (
        <Link
          to={`/kitforce/assignments/${a.id}`}
          className="text-ink hover:text-accent"
        >
          {a.title}
        </Link>
      ),
    },
    {
      key: 'member',
      header: 'Member',
      cellClassName: 'text-ink-dim',
      render: (a) =>
        a.member_id
          ? memberName[a.member_id] ?? a.member_id.slice(0, 8)
          : 'Unassigned',
    },
    {
      key: 'status',
      header: 'Status',
      render: (a) => <StatusBadge status={a.status} />,
    },
    {
      key: 'planned',
      header: 'Planned min',
      align: 'right',
      cellClassName: 'font-mono text-ink-dim',
      render: (a) => a.planned_minutes ?? '',
    },
  ];

  const rows = assignments.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !assignments.isLoading && !assignments.error
      ? `${totalCount} ${totalCount === 1 ? 'assignment' : 'assignments'}`
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
    !assignments.isLoading &&
    !assignments.error &&
    totalCount === 0 &&
    status === 'all' &&
    !memberFilter;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="Workforce / Assignments" title="Assignments" meta={meta} />

      {canCreate ? (
        <form
          onSubmit={onSubmit}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end border border-line bg-bg-2 p-4"
        >
          <div className="lg:col-span-2">
            <TextInput
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">
              Member (optional)
            </span>
            <Select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              disabled={members.isLoading}
            >
              <option value="">Unassigned</option>
              {(members.data ?? [])
                .filter((m) => m.status === 'active')
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
            </Select>
          </label>
          <TextInput
            label="Planned minutes (optional)"
            inputMode="numeric"
            value={plannedMinutes}
            onChange={(e) => setPlannedMinutes(e.target.value)}
          />
          <Button type="submit" disabled={!title.trim() || create.isPending}>
            {create.isPending ? 'Saving.' : 'Add assignment'}
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
            {ASSIGNMENT_STATUSES.map((s) => (
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

      {assignments.error ? (
        <p className="text-accent font-sans text-sm">
          {assignments.error instanceof Error
            ? assignments.error.message
            : 'Failed to load assignments.'}
        </p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="assignment"
          explainer="Assignments are units of work you queue and route to a member. Create one to start tracking work."
          addLabel="Add assignment"
          addTo="/kitforce/assignments"
          canAdd={false}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={pageRows}
            getRowKey={(a) => a.id}
            loading={assignments.isLoading}
            empty="No assignments match the current filters."
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
