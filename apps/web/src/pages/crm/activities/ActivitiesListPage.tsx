// ActivitiesListPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01, CRM
// mid): PageHeader + FilterBar + Select + DataTable + StatusBadge + Pagination
// replace the hand-rolled header, raw status select, table, and pager. Behavior
// preserved: the status filter still defaults to "open" (shown as a removable
// chip), the page resets on filter change, and the onboarding ListEmptyState
// still renders on an empty result set.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, type FilterChip } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { activitiesKeys } from '@/lib/queryKeys/activities';
import { listActivities } from '@/lib/services/activitiesService';
import type { Activity } from '@/lib/types/crm';

const PAGE_SIZE = 50;

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
        eyebrow="CRM / Activities"
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
