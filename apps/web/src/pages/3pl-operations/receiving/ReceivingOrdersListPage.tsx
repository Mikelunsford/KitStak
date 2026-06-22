// ReceivingOrdersListPage. Workstream C of the 2026-06-17 UI scan adds the
// server list toolbar (search on receiving number, sortable headers, status
// facet, keyset pager, saved views) behind feature.list_toolbar. The flag-off
// path is the original client-state view (the F-Wave10-UI-KIT-01 migration:
// PageHeader + DataTable + StatusBadge + Pagination, with the cap-gated create
// CTA and the ?project_id= server-side filter banner), extracted verbatim into
// ReceivingOrdersListLegacy; the flag-on path is ReceivingOrdersListToolbar. The
// parent renders one or the other.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useReceivingOrdersList } from '@/lib/hooks/useOps';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { listReceivingOrdersPage } from '@/lib/services/receivingOrdersService';
import { receivingOrdersKeys } from '@/lib/queryKeys/ops';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { ReceivingOrder } from '@/lib/services/receivingOrdersService';
import { parseProjectIdParam } from './receivingProjectParam';

const PAGE_SIZE = 50;

// Receiving order statuses the status facet accepts. Ordered for the dropdown.
const RECEIVING_STATUSES = ['created', 'in_progress', 'received', 'cancelled'] as const;

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
    sortKey: 'status',
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
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <ReceivingOrdersListToolbar />
  ) : (
    <ReceivingOrdersListLegacy />
  );
}

function ReceivingOrdersListToolbar() {
  const caps = useVioCapabilities();
  const server = useServerList<ReceivingOrder>({
    enabled: true,
    queryKeyBase: receivingOrdersKeys.all,
    fetchPage: listReceivingOrdersPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'status', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Receiving"
        actions={
          caps.can('receiving.order.create') ? (
            <Link to="/3pl-operations/receiving/new">
              <Button variant="primary">New receiving order</Button>
            </Link>
          ) : null
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search receiving number"
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
            {RECEIVING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="receiving_order"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load receiving orders.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(r) => r.id}
            loading={server.isLoading}
            empty="No receiving orders match these filters."
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

function ReceivingOrdersListLegacy() {
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
