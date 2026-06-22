// VendorBillsListPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01, 3PL
// CRUD tail): PageHeader + DataTable + StatusBadge + Pagination replace the
// hand-rolled header, the raw status pill, and the hand-rolled table. Behavior
// preserved: the create CTA stays gated on vendor_bills.vendor_bill.create and
// the onboarding ListEmptyState still renders on a true empty list.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useVendorBillsList } from '@/lib/hooks/useVendorBills';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatCents } from '@/lib/money';
import type { VendorBill } from '@/lib/types/vendors_inventory_ops';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<VendorBill>> = [
  {
    key: 'number',
    header: 'Bill #',
    cellClassName: 'tabular-nums',
    render: (b) => (
      <Link
        to={`/purchasing/vendor-bills/${b.id}`}
        className={LINK_CLASS}
      >
        {b.bill_number ?? b.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'vendor',
    header: 'Vendor',
    cellClassName: 'text-ink-dim',
    render: (b) => <EntityLabel kind="vendor" id={b.vendor_id} />,
  },
  {
    key: 'status',
    header: 'Status',
    render: (b) => <StatusBadge status={b.status} />,
  },
  {
    key: 'total',
    header: 'Total',
    align: 'right',
    cellClassName: 'tabular-nums',
    render: (b) =>
      formatCents(b.total_cents as number | string, b.currency_code),
  },
  {
    key: 'balance',
    header: 'Balance',
    align: 'right',
    cellClassName: 'tabular-nums',
    render: (b) =>
      formatCents(b.balance_cents as number | string, b.currency_code),
  },
  {
    key: 'due',
    header: 'Due',
    cellClassName: 'text-ink-dim',
    render: (b) => b.due_date ?? '.',
  },
];

export function VendorBillsListPage() {
  const { data, isLoading, error } = useVendorBillsList();
  const caps = useVioCapabilities();
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'vendor bill' : 'vendor bills'}`
      : undefined;

  const showOnboardingEmpty = !isLoading && !error && totalCount === 0;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Vendor bills"
        meta={meta}
        actions={
          caps.can('vendor_bills.vendor_bill.create') ? (
            <Link to="/purchasing/vendor-bills/new">
              <Button variant="primary">New vendor bill</Button>
            </Link>
          ) : undefined
        }
      />

      {error ? (
        <p className="font-sans text-accent">Failed to load vendor bills.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="vendor bill"
          explainer="Vendor bills are invoices from your vendors."
          addLabel="Add vendor bill"
          addTo="/purchasing/vendor-bills/new"
          canAdd={caps.can('vendor_bills.vendor_bill.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(b) => b.id}
            loading={isLoading}
            empty="No vendor bills yet."
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
