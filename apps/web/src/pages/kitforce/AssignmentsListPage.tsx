// AssignmentsListPage. KitForce work queue. The flag-on path
// (feature.list_toolbar) is the server list toolbar (search on title /
// assignment number, sortable NOT NULL columns, status + member facets, keyset
// pager, saved views) via AssignmentsListToolbar. The flag-off path is the
// original client-state view (the F-Wave10-UI-KIT-01 migration: PageHeader +
// FilterBar + Select + DataTable + StatusBadge + Pagination), extracted verbatim
// into AssignmentsListLegacy. Assignments have no dedicated create page, so the
// inline create form (with its kit-Select member picker) stays on both paths.

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, type FilterChip } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { TextInput } from '@/components/ui/TextInput';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ReferenceField } from '@/components/data/ReferenceField';
import {
  useAssignmentsList,
  useMembersList,
  useCreateAssignment,
} from '@/lib/hooks/useKitForce';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { listAssignmentsPage } from '@/lib/services/kitforceService';
import { assignmentsKeys } from '@/lib/queryKeys/kitforce';
import { FEATURE_FLAGS } from '@/lib/constants';
import type {
  WorkAssignment,
  WorkAssignmentCreate,
  WorkAssignmentStatus,
} from '@/lib/types/kitforce';

const PAGE_SIZE = 50;

type StatusFilter = WorkAssignmentStatus | 'all';

function renderAssignmentDetails(a: WorkAssignment) {
  return <ReferenceField label="Number" value={a.assignment_number} />;
}

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

// Shared column set, parameterised by the member-id-to-name map. sortKey is set
// only on NOT NULL sortable columns (title, status); assignment_number is
// nullable, so it is search-only and surfaces in the row-detail disclosure.
function buildAssignmentColumns(
  memberName: Record<string, string>,
): ReadonlyArray<DataColumn<WorkAssignment>> {
  return [
    {
      key: 'title',
      header: 'Title',
      sortKey: 'title',
      render: (a) => (
        <Link to={`/kitforce/assignments/${a.id}`} className={LINK_CLASS}>
          {a.title ?? a.assignment_number}
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
      sortKey: 'status',
      render: (a) => <StatusBadge status={a.status} />,
    },
    {
      key: 'planned',
      header: 'Planned min',
      align: 'right',
      cellClassName: 'tabular-nums text-ink-dim',
      render: (a) => a.planned_minutes ?? '',
    },
  ];
}

// Inline create form shared by both paths. Assignments have no dedicated create
// page.
function AssignmentCreateForm() {
  const members = useMembersList();
  const create = useCreateAssignment();
  const caps = useVioCapabilities();
  const canCreate = caps.can('kitforce.assignment.create');

  const [title, setTitle] = useState('');
  const [memberId, setMemberId] = useState('');
  const [plannedMinutes, setPlannedMinutes] = useState('');

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

  if (!canCreate) {
    return create.error ? (
      <p className="text-accent font-sans text-sm">
        {create.error instanceof Error ? create.error.message : 'Create failed.'}
      </p>
    ) : null;
  }

  return (
    <>
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
      {create.error ? (
        <p className="text-accent font-sans text-sm">
          {create.error instanceof Error ? create.error.message : 'Create failed.'}
        </p>
      ) : null}
    </>
  );
}

export function AssignmentsListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <AssignmentsListToolbar />
  ) : (
    <AssignmentsListLegacy />
  );
}

function AssignmentsListToolbar() {
  const members = useMembersList();

  const server = useServerList<WorkAssignment>({
    enabled: true,
    queryKeyBase: assignmentsKeys.all,
    fetchPage: listAssignmentsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [
      { key: 'status', label: 'Status', format: humaniseStatus },
      { key: 'member_id', label: 'Member' },
    ],
  });

  const memberName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members.data ?? []) map[m.id] = m.display_name;
    return map;
  }, [members.data]);

  const columns = useMemo(() => buildAssignmentColumns(memberName), [memberName]);

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="KitForce / Assignments" title="Assignments" />

      <AssignmentCreateForm />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search title or number"
        chips={server.chips}
        onClearAll={server.clearAll}
      >
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">
            Status
          </span>
          <Select
            value={server.facetValues.status ?? ''}
            onChange={(e) => server.setFacet('status', e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All</option>
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
            value={server.facetValues.member_id ?? ''}
            onChange={(e) => server.setFacet('member_id', e.target.value)}
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
      </ListToolbar>

      <SavedViewsBar
        entityType="assignment"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="text-accent font-sans text-sm">Failed to load assignments.</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={server.rows}
            getRowKey={(a) => a.id}
            loading={server.isLoading}
            empty="No assignments match these filters."
            renderRowDetails={renderAssignmentDetails}
            sortBy={server.sortBy}
            sortDir={server.sortDir}
            onSort={server.onSort}
          />
          <CursorPager
            canPrev={server.canPrev}
            canNext={server.canNext}
            onPrev={server.onPrev}
            onNext={server.onNext}
            label={`${server.rows.length} shown`}
          />
        </>
      )}
    </section>
  );
}

function AssignmentsListLegacy() {
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

  const columns = useMemo(() => buildAssignmentColumns(memberName), [memberName]);

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
      <PageHeader eyebrow="KitForce / Assignments" title="Assignments" meta={meta} />

      <AssignmentCreateForm />

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
            renderRowDetails={renderAssignmentDetails}
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
