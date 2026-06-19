// ShipmentsListPage. Migrated to the shared UI kit (F-Wave10-UI-KIT-01):
// PageHeader + FilterBar + Select + DataTable + StatusBadge + Pagination
// replace the hand-rolled header, inline status pill, table, and (previously
// absent) pagination. Behavior preserved: the create CTA stays ungated as
// before; the ?status= deep-link still filters the list client-side and an
// invalid value falls back to the full list. The status filter is now an
// interactive Select that writes the value back to the URL, replacing the
// previous read-only "Filtering by status" note.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, type FilterChip } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useShipmentsList } from '@/lib/hooks/useOps';
import type { Shipment } from '@/lib/services/shipmentsService';

const PAGE_SIZE = 50;

// Shipment statuses the list accepts via ?status=. Ordered for the filter
// dropdown; an arbitrary string never reaches the filter state.
const SHIPMENT_STATUSES = ['created', 'picking', 'shipped', 'cancelled'] as const;

const ALLOWED_SHIPMENT_STATUSES = new Set<string>(SHIPMENT_STATUSES);

function parseShipmentStatusParam(raw: string | null): string | undefined {
  if (raw && ALLOWED_SHIPMENT_STATUSES.has(raw)) return raw;
  return undefined;
}

const COLUMNS: ReadonlyArray<DataColumn<Shipment>> = [
  {
    key: 'number',
    header: '#',
    cellClassName: 'tabular-nums',
    render: (s) => (
      <Link
        to={`/3pl-operations/shipments/${s.id}`}
        className={LINK_CLASS}
      >
        {s.shipment_number ?? s.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (s) => <StatusBadge status={s.status} />,
  },
  {
    key: 'customer',
    header: 'Customer',
    cellClassName: 'text-ink-dim',
    render: (s) =>
      s.customer_id ? <EntityLabel kind="customer" id={s.customer_id} /> : '.',
  },
  {
    key: 'project',
    header: 'Project',
    cellClassName: 'text-ink-dim',
    render: (s) =>
      s.project_id ? <EntityLabel kind="project" id={s.project_id} /> : '.',
  },
  {
    key: 'warehouse',
    header: 'Warehouse',
    cellClassName: 'text-ink-dim',
    render: (s) => <EntityLabel kind="warehouse" id={s.warehouse_id} />,
  },
  {
    key: 'ship_date',
    header: 'Ship date',
    cellClassName: 'text-ink-dim',
    render: (s) => s.ship_date ?? '',
  },
  {
    key: 'carrier',
    header: 'Carrier',
    cellClassName: 'text-ink-dim',
    render: (s) => s.carrier ?? '',
  },
];

export function ShipmentsListPage() {
  // UX-Q5: support ?status= deep-links from the dashboard work card
  // ("Shipments ready to ship" -> ?status=picking). The shipments service
  // does not yet accept a status filter on the wire, so the predicate is
  // applied client-side over the page payload. This is acceptable because
  // the v1 operator's working set is small and the page is already paged
  // through TanStack Query.
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = parseShipmentStatusParam(searchParams.get('status'));
  const [page, setPage] = useState(0);

  const { data, isLoading } = useShipmentsList();

  function applyStatusFilter(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('status', next);
    else params.delete('status');
    setSearchParams(params, { replace: true });
    setPage(0);
  }

  const allRows = data ?? [];
  const rows = statusFilter
    ? allRows.filter((s) => s.status === statusFilter)
    : allRows;
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const chips: FilterChip[] = statusFilter
    ? [
        {
          key: 'status',
          label: `Status: ${humaniseStatus(statusFilter)}`,
          onClear: () => applyStatusFilter(''),
        },
      ]
    : [];

  const showOnboardingEmpty =
    !isLoading && !statusFilter && allRows.length === 0;

  const meta = !isLoading
    ? `${totalCount} ${totalCount === 1 ? 'shipment' : 'shipments'}`
    : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="3PL Operations / Shipments"
        title="Shipments"
        meta={meta}
        actions={
          <Link to="/3pl-operations/shipments/new">
            <Button variant="primary">New shipment</Button>
          </Link>
        }
      />

      <FilterBar chips={chips}>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Status
          </span>
          <Select
            value={statusFilter ?? ''}
            onChange={(e) => applyStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {SHIPMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      {showOnboardingEmpty ? (
        <ListEmptyState
          entity="shipment"
          explainer="Shipments track outbound inventory leaving the warehouse."
          addLabel="Add shipment"
          addTo="/3pl-operations/shipments/new"
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(s) => s.id}
            loading={isLoading}
            empty="No shipments match this filter."
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
