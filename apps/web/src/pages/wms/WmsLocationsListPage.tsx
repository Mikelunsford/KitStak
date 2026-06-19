// WmsLocationsListPage (Wave 12 Body B Phase B1). The WMS add-on's first
// surface: the bins, shelves, racks, docks, and staging areas inside a
// warehouse. UI scan Workstream C adds the server list toolbar (search on code,
// sortable headers, location-type facet, keyset pager, saved views) behind
// feature.list_toolbar. The flag-off path is the original client-state view,
// extracted verbatim into WmsLocationsListLegacy; the flag-on path is
// WmsLocationsListToolbar. The parent renders one or the other. The create CTA
// is gated on wms.location.create; the server is authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
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
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useWmsLocationsList } from '@/lib/hooks/useWmsLocations';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listWmsLocationsPage } from '@/lib/services/wmsLocationsService';
import { wmsLocationsKeys } from '@/lib/queryKeys/wms';
import { FEATURE_FLAGS } from '@/lib/constants';
import type {
  WarehouseLocation,
  WarehouseLocationType,
} from '@/lib/services/wmsLocationsService';

const PAGE_SIZE = 50;

const LOCATION_TYPES = ['bin', 'shelf', 'rack', 'dock', 'staging'] as const;

const COLUMNS: ReadonlyArray<DataColumn<WarehouseLocation>> = [
  {
    key: 'code',
    header: 'Code',
    sortKey: 'code',
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
    sortKey: 'location_type',
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
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <WmsLocationsListToolbar />
  ) : (
    <WmsLocationsListLegacy />
  );
}

function WmsLocationsListToolbar() {
  const caps = useCapabilities();
  const server = useServerList<WarehouseLocation>({
    enabled: true,
    queryKeyBase: wmsLocationsKeys.all,
    fetchPage: listWmsLocationsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'location_type', label: 'Type' }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="WMS"
        title="Locations"
        actions={
          caps.can('wms.location.create') ? (
            <Link to="/wms/locations/new">
              <Button variant="primary">New location</Button>
            </Link>
          ) : null
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search code"
        chips={server.chips}
        onClearAll={server.clearAll}
      >
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Type
          </span>
          <Select
            value={server.facetValues.location_type ?? ''}
            onChange={(e) => server.setFacet('location_type', e.target.value)}
            aria-label="Filter locations by type"
          >
            <option value="">All types</option>
            {LOCATION_TYPES.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="warehouse_location"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load locations.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(l) => l.id}
            loading={server.isLoading}
            empty="No locations match these filters."
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

function WmsLocationsListLegacy() {
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
