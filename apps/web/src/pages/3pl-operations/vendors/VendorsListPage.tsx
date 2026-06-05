// VendorsListPage. Migrated to the shared UI kit (F-Wave10-UI-KIT-01):
// PageHeader + FilterBar + DataTable + Pagination replace the hand-rolled
// header, raw name filter, table, and (previously absent) pagination.
// Behavior preserved: the client-side display_name filter still drives the
// list, the vendors.vendor.create capability still gates the New vendor CTA,
// and the onboarding empty state still shows when the org has no vendors.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { useVendorsList } from '@/lib/hooks/useVendors';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { Vendor } from '@/lib/types/vendors_inventory_ops';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<Vendor>> = [
  {
    key: 'name',
    header: 'Name',
    render: (v) => (
      <Link
        to={`/purchasing/vendors/${v.id}`}
        className="text-ink hover:text-accent"
      >
        {v.display_name}
      </Link>
    ),
  },
  {
    key: 'number',
    header: 'Number',
    cellClassName: 'font-mono',
    render: (v) => v.vendor_number ?? '',
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

/**
 * VendorsListPage. Lists active vendors for the caller's org.
 *
 * Filterable by display_name. Capability gate `vendors.vendor.create` hides
 * the Create button when the role lacks it.
 */
export function VendorsListPage() {
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
        eyebrow="Library / Vendors"
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
