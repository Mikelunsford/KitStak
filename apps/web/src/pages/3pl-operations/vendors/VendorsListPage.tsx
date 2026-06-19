// VendorsListPage. Workstream C of the 2026-06-17 UI scan adds the server list
// toolbar (search on vendor name and number, sortable headers, keyset pager,
// saved views) behind feature.list_toolbar. The flag-off path is the original
// client-state view (the F-Wave10-UI-KIT-01 migration: PageHeader + FilterBar +
// DataTable + Pagination, with the display_name filter applied client-side),
// extracted verbatim into VendorsListLegacy; the flag-on path is
// VendorsListToolbar. The parent renders one or the other.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ReferenceField } from '@/components/data/ReferenceField';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { useVendorsList } from '@/lib/hooks/useVendors';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listVendorsPage } from '@/lib/services/vendorsService';
import { vendorsKeys } from '@/lib/queryKeys/vendors';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { Vendor } from '@/lib/types/vendors_inventory_ops';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<Vendor>> = [
  {
    key: 'name',
    header: 'Name',
    sortKey: 'display_name',
    render: (v) => (
      <Link to={`/purchasing/vendors/${v.id}`} className={LINK_CLASS}>
        {v.display_name ?? v.vendor_number}
      </Link>
    ),
  },
  {
    key: 'currency',
    header: 'Currency',
    cellClassName: 'text-ink-dim',
    render: (v) => v.default_currency_code,
  },
  {
    key: 'terms',
    header: 'Terms',
    cellClassName: 'text-ink-dim',
    render: (v) => `${v.default_payment_terms_days}d`,
  },
];

function renderVendorDetails(v: Vendor) {
  return <ReferenceField label="Number" value={v.vendor_number} />;
}

export function VendorsListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <VendorsListToolbar />
  ) : (
    <VendorsListLegacy />
  );
}

function VendorsListToolbar() {
  const caps = useVioCapabilities();
  const server = useServerList<Vendor>({
    enabled: true,
    queryKeyBase: vendorsKeys.all,
    fetchPage: listVendorsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Purchasing / Vendors"
        title="Vendors"
        actions={
          caps.can('vendors.vendor.create') ? (
            <Link to="/purchasing/vendors/new">
              <Button variant="primary">New vendor</Button>
            </Link>
          ) : null
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search name or number"
        chips={server.chips}
        onClearAll={server.clearAll}
      />

      <SavedViewsBar
        entityType="vendor"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load vendors.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(v) => v.id}
            loading={server.isLoading}
            empty="No vendors match these filters."
            renderRowDetails={renderVendorDetails}
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

/**
 * VendorsListLegacy. Lists active vendors for the caller's org.
 *
 * Filterable by display_name. Capability gate `vendors.vendor.create` hides
 * the Create button when the role lacks it.
 */
function VendorsListLegacy() {
  const { data, isLoading, error } = useVendorsList();
  const caps = useVioCapabilities();
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const rows = data?.items ?? [];
    if (!filter.trim()) return rows;
    const needle = filter.toLowerCase();
    return rows.filter((r) => r.display_name.toLowerCase().includes(needle));
  }, [data, filter]);

  const totalCount = filtered.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = filtered.slice(sliceStart, sliceEnd);

  const showOnboardingEmpty =
    !isLoading && !error && (data?.items?.length ?? 0) === 0 && !filter;

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'vendor' : 'vendors'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Purchasing / Vendors"
        title="Vendors"
        meta={meta}
        actions={
          caps.can('vendors.vendor.create') ? (
            <Link to="/purchasing/vendors/new">
              <Button variant="primary">New vendor</Button>
            </Link>
          ) : null
        }
      />

      <FilterBar>
        <input
          type="text"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
          placeholder="Filter by name"
          aria-label="Search vendors by name"
          className="min-w-56 flex-1 border border-line bg-bg-2 px-3 py-2 font-sans text-sm"
        />
      </FilterBar>

      {error ? (
        <p className="font-sans text-accent">Failed to load vendors.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="vendor"
          explainer="Vendors are the companies you buy materials from."
          addLabel="Add vendor"
          addTo="/purchasing/vendors/new"
          canAdd={caps.can('vendors.vendor.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(v) => v.id}
            loading={isLoading}
            empty="No vendors match this search."
            renderRowDetails={renderVendorDetails}
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
