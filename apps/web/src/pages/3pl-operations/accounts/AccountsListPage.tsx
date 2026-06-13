// AccountsListPage (Wave 12 Phase A1). The 3PL commercial layer's first
// surface: the service-relationship accounts that sit over a CRM customer.
// Shared UI kit (PageHeader + FilterBar + DataTable + Pagination + StatusBadge)
// matching the Vendors / Receiving list surfaces. The status filter narrows the
// list server-side (three-pl-api GET /accounts?status=). The create CTA is
// gated on threepl.account.create; the server is authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAccountsList } from '@/lib/hooks/useAccounts';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import type {
  ThreePlAccount,
  ThreePlAccountStatus,
} from '@/lib/services/accountsService';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<ThreePlAccount>> = [
  {
    key: 'name',
    header: 'Name',
    render: (a) => (
      <Link
        to={`/3pl-operations/accounts/${a.id}`}
        className="text-ink hover:text-accent"
      >
        {a.name}
      </Link>
    ),
  },
  {
    key: 'number',
    header: 'Account #',
    cellClassName: 'font-mono',
    render: (a) => a.account_number ?? a.id.slice(0, 8),
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
    render: (a) => <StatusBadge status={a.status} />,
  },
];

export function AccountsListPage() {
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
        eyebrow="3PL Operations"
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
