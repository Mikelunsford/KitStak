// CustomersListPage. Workstream C of the 2026-06-17 UI scan adds the server
// list toolbar (search on name + email, sortable headers, status + kind facets,
// keyset pager) behind feature.list_toolbar. The flag-off path is the original
// client-state view, extracted verbatim into CustomersListLegacy; the flag-on
// path is CustomersListToolbar. The parent renders one or the other.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, type FilterChip } from '@/components/ui/FilterBar';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useCustomers } from '@/lib/hooks/useCustomers';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listCustomersPage } from '@/lib/services/customersService';
import { customersKeys } from '@/lib/queryKeys/customers';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { Customer } from '@/lib/types/crm';

const PAGE_SIZE = 50;

const CUSTOMER_STATUSES = ['new', 'active', 'inactive'] as const;
const CUSTOMER_KINDS = ['company', 'individual'] as const;

const COLUMNS: ReadonlyArray<DataColumn<Customer>> = [
  {
    key: 'name',
    header: 'Name',
    sortKey: 'display_name',
    render: (c) => (
      <Link to={`/crm/customers/${c.id}`} className="text-ink hover:text-accent">
        {c.display_name}
      </Link>
    ),
  },
  { key: 'kind', header: 'Kind', render: (c) => c.kind },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (c) => <StatusBadge status={c.status} />,
  },
  {
    key: 'email',
    header: 'Email',
    cellClassName: 'text-ink-dim',
    render: (c) => c.primary_email ?? '',
  },
];

export function CustomersListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <CustomersListToolbar />
  ) : (
    <CustomersListLegacy />
  );
}

function CustomersListToolbar() {
  const server = useServerList<Customer>({
    enabled: true,
    queryKeyBase: customersKeys.all,
    fetchPage: listCustomersPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [
      { key: 'status', label: 'Status', format: humaniseStatus },
      { key: 'kind', label: 'Kind' },
    ],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-10">
      <PageHeader
        eyebrow="CRM / Customers"
        title="Customers"
        actions={
          <Link to="/crm/customers/new">
            <Button variant="primary">New customer</Button>
          </Link>
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search name or email"
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
            {CUSTOMER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Kind
          </span>
          <Select
            value={server.facetValues.kind ?? ''}
            onChange={(e) => server.setFacet('kind', e.target.value)}
            aria-label="Filter by kind"
          >
            <option value="">All kinds</option>
            {CUSTOMER_KINDS.map((k) => (
              <option key={k} value={k}>
                {humaniseStatus(k)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="customer"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load customers.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(c) => c.id}
            loading={server.isLoading}
            empty="No customers match these filters."
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

function CustomersListLegacy() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  const filters = {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
  };
  const query = useCustomers(filters);

  const rows = query.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const hasFilter = Boolean(q || status);
  const chips: FilterChip[] = status
    ? [
        {
          key: 'status',
          label: `Status: ${humaniseStatus(status)}`,
          onClear: () => {
            setStatus('');
            setPage(0);
          },
        },
      ]
    : [];

  const showOnboardingEmpty =
    !query.isLoading && !query.isError && !hasFilter && totalCount === 0;

  const meta =
    !query.isLoading && !query.isError
      ? `${totalCount} ${totalCount === 1 ? 'customer' : 'customers'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-10">
      <PageHeader
        eyebrow="CRM / Customers"
        title="Customers"
        meta={meta}
        actions={
          <Link to="/crm/customers/new">
            <Button variant="primary">New customer</Button>
          </Link>
        }
      />

      <FilterBar
        chips={chips}
        {...(hasFilter
          ? {
              onClearAll: () => {
                setQ('');
                setStatus('');
                setPage(0);
              },
            }
          : {})}
      >
        <input
          type="text"
          placeholder="Search by name"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          aria-label="Search customers by name"
          className="min-w-56 flex-1 border border-line bg-bg-2 px-3 py-2 font-sans text-sm"
        />
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Status
          </span>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {CUSTOMER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      {query.isError ? (
        <p className="font-sans text-accent">
          Failed to load customers.{' '}
          {query.error instanceof Error ? query.error.message : ''}
        </p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="customer"
          explainer="Customers are the businesses you sell to. Add one to start a quote."
          addLabel="Add customer"
          addTo="/crm/customers/new"
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(c) => c.id}
            loading={query.isLoading}
            empty="No customers match this filter."
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
