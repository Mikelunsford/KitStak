// ChartOfAccountsPage. Finance config surface. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DataTable + StatusBadge + Pagination
// replace the hand-rolled header, table, and yes/no active text. Chart of
// accounts is reference/config data (no FSM), sorted by code server-side.
// account_type is categorical (rendered as plain uppercase text, not a badge);
// is_active becomes a StatusBadge. No onboarding ListEmptyState (accounts are
// seeded); the empty state is the DataTable empty string. The per-row Edit link
// and the create CTA are preserved.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useChartOfAccounts } from '@/lib/hooks/useChartOfAccounts';
import type { ChartOfAccount } from '@/lib/types/finance';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<ChartOfAccount>> = [
  {
    key: 'code',
    header: 'Code',
    cellClassName: 'font-mono',
    render: (a) => a.code,
  },
  {
    key: 'name',
    header: 'Name',
    render: (a) => a.name,
  },
  {
    key: 'type',
    header: 'Type',
    cellClassName: 'uppercase text-ink-dim',
    render: (a) => a.account_type,
  },
  {
    key: 'active',
    header: 'Active',
    render: (a) => (
      <StatusBadge status={a.is_active ? 'active' : 'inactive'} />
    ),
  },
  {
    key: 'actions',
    header: '',
    align: 'right',
    render: (a) => (
      <Link
        to={`/finance/coa/${a.id}/edit`}
        className="text-ink-dim hover:text-accent text-xs"
      >
        Edit
      </Link>
    ),
  },
];

export function ChartOfAccountsPage() {
  const { data, isLoading, error } = useChartOfAccounts();
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'account' : 'accounts'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Finance / Chart of accounts"
        title="Chart of accounts"
        meta={meta}
        actions={
          <Link to="/finance/coa/new">
            <Button variant="primary">New account</Button>
          </Link>
        }
      />

      {error ? (
        <p className="text-accent font-sans">Failed to load accounts.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(a) => a.id}
            loading={isLoading}
            empty="No accounts found."
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
