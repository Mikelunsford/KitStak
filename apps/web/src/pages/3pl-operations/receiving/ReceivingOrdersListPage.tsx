// ReceivingOrdersListPage. Migrated to the shared UI kit (F-Wave10-UI-KIT-01):
// PageHeader + DataTable + StatusBadge + Pagination replace the hand-rolled
// header, inline status pill, and table. Behavior preserved: the create CTA
// stays gated on receiving.order.create, the ?project_id= deep-link still
// narrows the list server-side, and its active-filter banner (with the project
// label and a clear link) is unchanged. No status FilterBar here: receiving
// filters by project, not status.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useReceivingOrdersList } from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { ReceivingOrder } from '@/lib/services/receivingOrdersService';
import { parseProjectIdParam } from './receivingProjectParam';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<ReceivingOrder>> = [
  {
    key: 'number',
    header: '#',
    cellClassName: 'tabular-nums',
    render: (r) => (
      <Link
        to={`/3pl-operations/receiving/${r.id}`}
        className={LINK_CLASS}
      >
        {r.receiving_number ?? r.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (r) => <StatusBadge status={r.status} />,
  },
  {
    key: 'warehouse',
    header: 'Warehouse',
    cellClassName: 'text-ink-dim',
    render: (r) => <EntityLabel kind="warehouse" id={r.warehouse_id} />,
  },
  {
    key: 'project',
    header: 'Project',
    cellClassName: 'text-ink-dim',
    render: (r) =>
      r.project_id ? (
        <Link
          to={`/projects/${r.project_id}`}
          className="text-ink hover:text-accent"
        >
          <EntityLabel kind="project" id={r.project_id} />
        </Link>
      ) : (
        ''
      ),
  },
  {
    key: 'expected',
    header: 'Expected',
    cellClassName: 'text-ink-dim',
    render: (r) => r.expected_date ?? '',
  },
];

export function ReceivingOrdersListPage() {
  const [searchParams] = useSearchParams();
  // UX-Q6: optional server-side filter on project_id. When present, the
  // list shows only receiving orders bound to that project. Mirrors how
  // UX-Q5's status filter narrows the dashboard cards.
  const projectFilter = parseProjectIdParam(searchParams.get('project_id'));
  const { data, isLoading } = useReceivingOrdersList(
    projectFilter ? { project_id: projectFilter } : {},
  );
  const caps = useVioCapabilities();
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  // Onboarding empty (the guided "add your first" CTA) is only for a truly
  // empty list. When a project filter is active and matches nothing, the
  // DataTable's inline empty state shows inside the table frame instead.
  const showOnboardingEmpty = !isLoading && totalCount === 0 && !projectFilter;

  const meta = !isLoading
    ? `${totalCount} ${totalCount === 1 ? 'receiving order' : 'receiving orders'}`
    : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="3PL Operations / Receiving"
        title="Receiving"
        meta={meta}
        actions={
          caps.can('receiving.order.create') ? (
            <Link to="/3pl-operations/receiving/new">
              <Button variant="primary">New receiving order</Button>
            </Link>
          ) : null
        }
      />

      {projectFilter ? (
        <p className="font-sans text-sm text-ink-dim">
          Filtered to project <EntityLabel kind="project" id={projectFilter} />.{' '}
          <Link
            to="/3pl-operations/receiving"
            className="text-accent hover:text-accent-bright"
          >
            Clear filter
          </Link>
        </p>
      ) : null}

      {showOnboardingEmpty ? (
        <ListEmptyState
          entity="receiving order"
          explainer="Receiving orders track inbound inventory from a vendor or customer."
          addLabel="Add receiving order"
          addTo="/3pl-operations/receiving/new"
          canAdd={caps.can('receiving.order.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(r) => r.id}
            loading={isLoading}
            empty="No receiving orders match this filter."
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
