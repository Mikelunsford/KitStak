// ActivitiesListPage. Workstream C of the 2026-06-17 UI scan adds the server
// list toolbar (search on subject + body, sortable headers, status facet,
// keyset pager, saved views) behind feature.list_toolbar. The flag-off path is
// the original client-state view (the F-Wave10-UI-KIT-01 migration: PageHeader +
// FilterBar + Select + DataTable + StatusBadge + Pagination, with the status
// filter defaulting to "open"), extracted verbatim into ActivitiesListLegacy;
// the flag-on path is ActivitiesListToolbar. The parent renders one or the other.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, type FilterChip } from '@/components/ui/FilterBar';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { activitiesKeys } from '@/lib/queryKeys/activities';
import { listActivities, listActivitiesPage } from '@/lib/services/activitiesService';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { Activity } from '@/lib/types/crm';

const PAGE_SIZE = 50;

const ACTIVITY_STATUSES = ['open', 'completed', 'cancelled'] as const;

const COLUMNS: ReadonlyArray<DataColumn<Activity>> = [
  {
    key: 'kind',
    header: 'Kind',
    cellClassName: 'text-ink-dim',
    render: (a) => a.kind,
  },
  {
    key: 'subject',
    header: 'Subject',
    render: (a) => a.subject,
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (a) => <StatusBadge status={a.status} />,
  },
  {
    key: 'due',
    header: 'Due',
    cellClassName: 'text-ink-dim',
    render: (a) => a.due_at ?? '',
  },
];

export function ActivitiesListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <ActivitiesListToolbar />
  ) : (
    <ActivitiesListLegacy />
  );
}

function ActivitiesListToolbar() {
  const server = useServerList<Activity>({
    enabled: true,
    queryKeyBase: activitiesKeys.all,
    fetchPage: listActivitiesPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'status', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Activities"
        actions={
          <Link to="/crm/activities/new">
            <Button variant="primary">New activity</Button>
          </Link>
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search subject or body"
        chips={server.chips}
        onClearAll={server.clearAll}
      >
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Status
          </span>
          <Select
            value={server.facetValues.status ?? ''}
            onChange={(e) => server.setFacet('status', e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {ACTIVITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="activity"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load activities.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(a) => a.id}
            loading={server.isLoading}
            empty="No activities match these filters."
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

function ActivitiesListLegacy() {
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(0);
  const filters = status ? { status } : {};
  const query = useQuery({
    queryKey: activitiesKeys.list(filters),
    queryFn: () => listActivities(filters),
    staleTime: 30_000,
  });

  function applyStatus(next: string) {
    setStatus(next);
    setPage(0);
  }

  const rows = query.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !query.isLoading && !query.isError
      ? `${totalCount} ${totalCount === 1 ? 'activity' : 'activities'}`
      : undefined;

  const chips: FilterChip[] = status
    ? [
        {
          key: 'status',
          label: `Status: ${humaniseStatus(status)}`,
          onClear: () => applyStatus(''),
        },
      ]
    : [];

  const showOnboardingEmpty =
    !query.isLoading && !query.isError && totalCount === 0;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Activities"
        meta={meta}
        actions={
          <Link to="/crm/activities/new">
            <Button variant="primary">New activity</Button>
          </Link>
        }
      />

      <FilterBar chips={chips}>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Status
          </span>
          <Select
            value={status}
            onChange={(e) => applyStatus(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </label>
      </FilterBar>

      {query.isError ? (
        <p className="font-sans text-accent">Failed to load activities.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="activity"
          explainer="Activities log calls, emails, and notes against a customer or opportunity."
          addLabel="Add activity"
          addTo="/crm/activities/new"
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(a) => a.id}
            loading={query.isLoading}
            empty="No activities match this filter."
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
