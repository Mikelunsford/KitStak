// JobRunsListPage (Wave 12 Phase A6). The Job Run list surface: the day-by-day
// floor execution of a project. Workstream C of the 2026-06-17 UI scan adds the
// server list toolbar (search on run number, sortable headers, status facet,
// keyset pager, saved views) behind feature.list_toolbar. The flag-off path is
// the original client-state view (PageHeader + FilterBar + Select + DataTable +
// StatusBadge + Pagination), extracted verbatim into JobRunsListLegacy; the
// flag-on path is JobRunsListToolbar. The parent renders one or the other. The
// create CTA is gated on threepl.job_run.create in both paths; the server is
// authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useJobRunsList } from '@/lib/hooks/useJobRuns';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listJobRunsPage } from '@/lib/services/jobRunsService';
import { jobRunsKeys } from '@/lib/queryKeys/threepl';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { JobRun, JobRunStatus } from '@/lib/services/jobRunsService';

const PAGE_SIZE = 50;

const JOB_RUN_STATUSES: ReadonlyArray<JobRunStatus> = [
  'planned',
  'in_progress',
  'completed',
  'closed',
  'cancelled',
];

const COLUMNS: ReadonlyArray<DataColumn<JobRun>> = [
  {
    key: 'number',
    header: 'Run #',
    cellClassName: 'tabular-nums',
    render: (r) => (
      <Link to={`/3pl-operations/job-runs/${r.id}`} className={LINK_CLASS}>
        {r.run_number ?? r.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (r) => <StatusBadge status={r.status} />,
  },
  {
    key: 'created',
    header: 'Created',
    sortKey: 'created_at',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (r) => r.created_at.slice(0, 10),
  },
];

export function JobRunsListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <JobRunsListToolbar />
  ) : (
    <JobRunsListLegacy />
  );
}

function JobRunsListToolbar() {
  const caps = useCapabilities();
  const server = useServerList<JobRun>({
    enabled: true,
    queryKeyBase: jobRunsKeys.all,
    fetchPage: listJobRunsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'status', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Job Runs"
        actions={
          caps.can('threepl.job_run.create') ? (
            <Link to="/3pl-operations/job-runs/new">
              <Button variant="primary">New job run</Button>
            </Link>
          ) : null
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search run number"
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
            aria-label="Filter job runs by status"
          >
            <option value="">All statuses</option>
            {JOB_RUN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="job_run"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load job runs.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(r) => r.id}
            loading={server.isLoading}
            empty="No job runs match these filters."
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

function JobRunsListLegacy() {
  const [status, setStatus] = useState<JobRunStatus | ''>('');
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useJobRunsList({
    ...(status ? { status } : {}),
  });
  const caps = useCapabilities();

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const showOnboardingEmpty =
    !isLoading && !error && totalCount === 0 && !status;

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'job run' : 'job runs'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Job Runs"
        meta={meta}
        actions={
          caps.can('threepl.job_run.create') ? (
            <Link to="/3pl-operations/job-runs/new">
              <Button variant="primary">New job run</Button>
            </Link>
          ) : null
        }
      />

      <FilterBar>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as JobRunStatus | '');
            setPage(0);
          }}
          aria-label="Filter job runs by status"
        >
          <option value="">All statuses</option>
          <option value="planned">Planned</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="closed">Closed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </FilterBar>

      {error ? (
        <p className="font-sans text-accent">Failed to load job runs.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="job run"
          explainer="Job runs are the day-by-day floor execution of a project. Each day's work is a daily log; posting a log records what was consumed and produced against inventory."
          addLabel="Add job run"
          addTo="/3pl-operations/job-runs/new"
          canAdd={caps.can('threepl.job_run.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(r) => r.id}
            loading={isLoading}
            empty="No job runs match this filter."
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
