// WmsLocationsListPage (Wave 12 Body B Phase B1). The WMS add-on's first
// surface: the bins, shelves, racks, docks, and staging areas inside a
// warehouse. Shared UI kit (PageHeader + FilterBar + DataTable + Pagination +
// StatusBadge) matching the Accounts / Receiving list surfaces. The location
// type filter narrows the list server-side (wms-api GET /locations?
// location_type=). The create CTA is gated on wms.location.create; the server
// is authority.

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
import { useWmsLocationsList } from '@/lib/hooks/useWmsLocations';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import type {
  WarehouseLocation,
  WarehouseLocationType,
} from '@/lib/services/wmsLocationsService';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<WarehouseLocation>> = [
  {
    key: 'code',
    header: 'Code',
    cellClassName: 'tabular-nums',
    render: (l) => (
      <Link to={`/wms/locations/${l.id}`} className={LINK_CLASS}>
        {l.code}
      </Link>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    cellClassName: 'text-ink-dim capitalize',
    render: (l) => l.location_type,
  },
  {
    key: 'warehouse',
    header: 'Warehouse',
    cellClassName: 'text-ink-dim',
    render: (l) => <EntityLabel kind="warehouse" id={l.warehouse_id} />,
  },
  {
    key: 'status',
    header: 'Status',
    render: (l) => <StatusBadge status={l.active ? 'active' : 'inactive'} />,
  },
];

export function WmsLocationsListPage() {
  const [locationType, setLocationType] = useState<WarehouseLocationType | ''>('');
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useWmsLocationsList(
    locationType ? { location_type: locationType } : {},
  );
  const caps = useCapabilities();

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  // Onboarding empty (the guided "add your first" CTA) only when the org has no
  // locations at all. When a type filter matches nothing, the DataTable inline
  // empty state shows inside the frame instead.
  const showOnboardingEmpty =
    !isLoading && !error && totalCount === 0 && !locationType;

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'location' : 'locations'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="WMS"
        title="Locations"
        meta={meta}
        actions={
          caps.can('wms.location.create') ? (
            <Link to="/wms/locations/new">
              <Button variant="primary">New location</Button>
            </Link>
          ) : null
        }
      />

      <FilterBar>
        <Select
          value={locationType}
          onChange={(e) => {
            setLocationType(e.target.value as WarehouseLocationType | '');
            setPage(0);
          }}
          aria-label="Filter locations by type"
        >
          <option value="">All types</option>
          <option value="bin">Bin</option>
          <option value="shelf">Shelf</option>
          <option value="rack">Rack</option>
          <option value="dock">Dock</option>
          <option value="staging">Staging</option>
        </Select>
      </FilterBar>

      {error ? (
        <p className="font-sans text-accent">Failed to load locations.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="location"
          explainer="Locations are the bins, shelves, racks, docks, and staging areas inside a warehouse. They give your stock a place to live at bin level."
          addLabel="Add location"
          addTo="/wms/locations/new"
          canAdd={caps.can('wms.location.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(l) => l.id}
            loading={isLoading}
            empty="No locations match this filter."
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
