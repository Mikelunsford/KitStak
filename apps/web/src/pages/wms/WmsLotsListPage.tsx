// WmsLotsListPage (Wave 12 Body B Phase B4). The WMS lots surface: the lots /
// batches of an item, with optional expiration. Shared UI kit (PageHeader +
// FilterBar + DataTable + Pagination + StatusBadge) matching the Locations /
// Putaway list surfaces. The status filter narrows the list server-side (wms-api
// GET /lots?status=). The create CTA is gated on wms.lot.create; the server is
// authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useWmsLotsList } from '@/lib/hooks/useWmsLots';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import type { Lot, LotStatus } from '@/lib/services/wmsLotsService';

const PAGE_SIZE = 50;

function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}

const COLUMNS: ReadonlyArray<DataColumn<Lot>> = [
  {
    key: 'lot_code',
    header: 'Lot code',
    cellClassName: 'tabular-nums',
    render: (l) => (
      <Link to={`/wms/lots/${l.id}`} className={LINK_CLASS}>
        {l.lot_code}
      </Link>
    ),
  },
  {
    key: 'item',
    header: 'Item',
    cellClassName: 'text-ink-dim',
    render: (l) => <EntityLabel kind="item" id={l.item_id} />,
  },
  {
    key: 'expiration',
    header: 'Expires',
    cellClassName: 'text-ink-dim',
    render: (l) => formatDate(l.expiration_date),
  },
  {
    key: 'status',
    header: 'Status',
    render: (l) => <StatusBadge status={l.status} />,
  },
];

export function WmsLotsListPage() {
  const [status, setStatus] = useState<LotStatus | ''>('');
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useWmsLotsList(
    status ? { status } : {},
  );
  const caps = useCapabilities();

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  // Onboarding empty only when the org has no lots at all. When a status filter
  // matches nothing, the DataTable inline empty state shows inside the frame.
  const showOnboardingEmpty =
    !isLoading && !error && totalCount === 0 && !status;

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'lot' : 'lots'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="WMS"
        title="Lots"
        meta={meta}
        actions={
          caps.can('wms.lot.create') ? (
            <Link to="/wms/lots/new">
              <Button variant="primary">New lot</Button>
            </Link>
          ) : null
        }
      />

      <FilterBar>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as LotStatus | '');
            setPage(0);
          }}
          aria-label="Filter lots by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="quarantined">Quarantined</option>
          <option value="expired">Expired</option>
          <option value="consumed">Consumed</option>
        </Select>
      </FilterBar>

      {error ? (
        <p className="font-sans text-accent">Failed to load lots.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="lot"
          explainer="Lots are the batches of an item, with optional expiration. Capture them at receiving or putaway so stock is traceable at the lot level."
          addLabel="Add lot"
          addTo="/wms/lots/new"
          canAdd={caps.can('wms.lot.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(l) => l.id}
            loading={isLoading}
            empty="No lots match this filter."
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
