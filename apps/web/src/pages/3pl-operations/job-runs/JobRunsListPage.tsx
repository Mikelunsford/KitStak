// JobRunsListPage (Wave 12 Phase A6). The Job Run list surface: the day-by-day
// floor execution of a project. Shared UI kit (PageHeader + FilterBar +
// DataTable + Pagination + StatusBadge) matching the Supply Plans / Job Builders
// list surfaces. The status filter narrows server-side (three-pl-api
// GET /job-runs?status=). The create CTA is gated on threepl.job_run.create;
// the server is authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useJobRunsList } from '@/lib/hooks/useJobRuns';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import type { JobRun, JobRunStatus } from '@/lib/services/jobRunsService';

const PAGE_SIZE = 50;

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
    render: (r) => <StatusBadge status={r.status} />,
  },
  {
    key: 'created',
    header: 'Created',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (r) => r.created_at.slice(0, 10),
  },
];

export function JobRunsListPage() {
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
        eyebrow="3PL Operations"
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
