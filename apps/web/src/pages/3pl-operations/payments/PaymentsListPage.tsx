// PaymentsListPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01):
// PageHeader + DataTable + Pagination replace the hand-rolled header, table,
// and Prev / Next nav. No FilterBar and no status column for payments (the
// inflow ledger has no state machine surfaced here). Behavior preserved:
// inflow ledger by received_at desc, client-side PAGE_SIZE slicing, and the
// number cell still deep-links to the invoicing apply route.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { usePayments } from '@/lib/hooks/usePayments';
import { formatCents } from '@/lib/money';

const PAGE_SIZE = 50;

// Only the fields the list renders. amount_cents / unapplied_cents are
// number | string off the wire (FinanceCentsSchema); formatCents accepts both.
type PaymentRow = {
  id: string;
  payment_number: string;
  received_at: string;
  amount_cents: number | string;
  unapplied_cents: number | string;
  currency_code: string;
};

const COLUMNS: ReadonlyArray<DataColumn<PaymentRow>> = [
  {
    key: 'number',
    header: 'Number',
    cellClassName: 'tabular-nums',
    render: (p) => (
      <Link to={`/invoicing/payments/${p.id}/apply`} className={LINK_CLASS}>
        {p.payment_number}
      </Link>
    ),
  },
  {
    key: 'received',
    header: 'Received',
    cellClassName: 'text-ink-dim',
    render: (p) => new Date(p.received_at).toLocaleDateString(),
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    cellClassName: 'tabular-nums',
    render: (p) => formatCents(p.amount_cents, p.currency_code),
  },
  {
    key: 'unapplied',
    header: 'Unapplied',
    align: 'right',
    cellClassName: 'tabular-nums',
    render: (p) => formatCents(p.unapplied_cents, p.currency_code),
  },
];

/**
 * PaymentsListPage. Inflow ledger by received_at desc.
 */
export function PaymentsListPage() {
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = usePayments();

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const showOnboardingEmpty = !isLoading && !error && totalCount === 0;

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'payment' : 'payments'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Invoicing / Payments"
        title="Payments"
        meta={meta}
        actions={
          <Link to="/invoicing/payments/new">
            <Button variant="primary">New payment</Button>
          </Link>
        }
      />

      {error ? (
        <p className="font-sans text-accent">Failed to load payments.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="payment"
          explainer="Payments record cash received against an invoice."
          addLabel="Add payment"
          addTo="/invoicing/payments/new"
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(p) => p.id}
            loading={isLoading}
            empty="No payments recorded."
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
