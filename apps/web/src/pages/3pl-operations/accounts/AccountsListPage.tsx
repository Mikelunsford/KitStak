// AccountsListPage (Wave 12 Phase A1). The 3PL commercial layer's first
// surface: the service-relationship accounts that sit over a CRM customer.
// Workstream C of the 2026-06-17 UI scan adds the server list toolbar (search on
// name and account number, sortable headers, status facet, keyset pager, saved
// views) behind feature.list_toolbar. The flag-off path is the original
// client-state view (PageHeader + FilterBar + Select + DataTable + StatusBadge +
// Pagination), extracted verbatim into AccountsListLegacy; the flag-on path is
// AccountsListToolbar. The parent renders one or the other. The create CTA is
// gated on threepl.account.create in both paths; the server is authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ReferenceField } from '@/components/data/ReferenceField';
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
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useAccountsList } from '@/lib/hooks/useAccounts';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listAccountsPage } from '@/lib/services/accountsService';
import { accountsKeys } from '@/lib/queryKeys/threepl';
import { FEATURE_FLAGS } from '@/lib/constants';
import type {
  ThreePlAccount,
  ThreePlAccountStatus,
} from '@/lib/services/accountsService';

const PAGE_SIZE = 50;

const ACCOUNT_STATUSES: ReadonlyArray<ThreePlAccountStatus> = ['active', 'inactive'];

const COLUMNS: ReadonlyArray<DataColumn<ThreePlAccount>> = [
  {
    key: 'name',
    header: 'Name',
    sortKey: 'name',
    render: (a) => (
      <Link to={`/3pl-operations/accounts/${a.id}`} className={LINK_CLASS}>
        {a.name ?? a.account_number}
      </Link>
    ),
  },
  {
    key: 'customer',
    header: 'Customer',
    cellClassName: 'text-ink-dim',
    render: (a) => <EntityLabel kind="customer" id={a.customer_id} />,
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (a) => <StatusBadge status={a.status} />,
  },
];

function renderAccountDetails(a: ThreePlAccount) {
  return <ReferenceField label="Number" value={a.account_number} />;
}

export function AccountsListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <AccountsListToolbar />
  ) : (
    <AccountsListLegacy />
  );
}

function AccountsListToolbar() {
  const caps = useCapabilities();
  const server = useServerList<ThreePlAccount>({
    enabled: true,
    queryKeyBase: accountsKeys.all,
    fetchPage: listAccountsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'status', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Accounts"
        actions={
          caps.can('threepl.account.create') ? (
            <Link to="/3pl-operations/accounts/new">
              <Button variant="primary">New account</Button>
            </Link>
          ) : null
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search name or account number"
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
            aria-label="Filter accounts by status"
          >
            <option value="">All statuses</option>
            {ACCOUNT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="account"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load accounts.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(a) => a.id}
            loading={server.isLoading}
            empty="No accounts match these filters."
            renderRowDetails={renderAccountDetails}
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

function AccountsListLegacy() {
  const [status, setStatus] = useState<ThreePlAccountStatus | ''>('');
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useAccountsList(
    status ? { status } : {},
  );
  const caps = useCapabilities();

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  // Onboarding empty (the guided "add your first" CTA) only when the org has no
  // accounts at all. When a status filter matches nothing, the DataTable inline
  // empty state shows inside the frame instead.
  const showOnboardingEmpty = !isLoading && !error && totalCount === 0 && !status;

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'account' : 'accounts'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Accounts"
        meta={meta}
        actions={
          caps.can('threepl.account.create') ? (
            <Link to="/3pl-operations/accounts/new">
              <Button variant="primary">New account</Button>
            </Link>
          ) : null
        }
      />

      <FilterBar>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ThreePlAccountStatus | '');
            setPage(0);
          }}
          aria-label="Filter accounts by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </FilterBar>

      {error ? (
        <p className="font-sans text-accent">Failed to load accounts.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="account"
          explainer="Accounts are the 3PL service relationships you run for a customer. Each one carries its own rate card."
          addLabel="Add account"
          addTo="/3pl-operations/accounts/new"
          canAdd={caps.can('threepl.account.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(a) => a.id}
            loading={isLoading}
            empty="No accounts match this filter."
            renderRowDetails={renderAccountDetails}
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
