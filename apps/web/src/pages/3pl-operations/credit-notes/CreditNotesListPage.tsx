// CreditNotesListPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01, 3PL
// CRUD tail): PageHeader + DataTable + StatusBadge + Pagination replace the
// hand-rolled header, the raw uppercase status text, and the hand-rolled pager.
// Behavior preserved: the number link still targets the canonical
// /invoicing/credit-notes detail path while the create CTA targets
// /3pl-operations/credit-notes/new, and the onboarding ListEmptyState still
// renders on a true empty list.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useCreditNotes } from '@/lib/hooks/useCreditNotes';
import { formatCents } from '@/lib/money';
import type { CreditNote } from '@/lib/types/finance';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<CreditNote>> = [
  {
    key: 'number',
    header: 'Number',
    cellClassName: 'font-mono',
    render: (cn) => (
      <Link
        to={`/invoicing/credit-notes/${cn.id}`}
        className="text-ink hover:text-accent"
      >
        {cn.credit_note_number}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (cn) => <StatusBadge status={cn.status} />,
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    cellClassName: 'font-mono',
    render: (cn) =>
      formatCents(cn.amount_cents as number | string, cn.currency_code),
  },
  {
    key: 'applied',
    header: 'Applied',
    align: 'right',
    cellClassName: 'font-mono',
    render: (cn) =>
      formatCents(cn.applied_cents as number | string, cn.currency_code),
  },
];

/**
 * CreditNotesListPage. Lists credit notes for the active org.
 */
export function CreditNotesListPage() {
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = useCreditNotes();

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'credit note' : 'credit notes'}`
      : undefined;

  const showOnboardingEmpty = !isLoading && !error && totalCount === 0;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Get paid / Credit notes"
        title="Credit notes"
        meta={meta}
        actions={
          <Link to="/3pl-operations/credit-notes/new">
            <Button variant="primary">New credit note</Button>
          </Link>
        }
      />

      {error ? (
        <p className="font-sans text-accent">Failed to load credit notes.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="credit note"
          explainer="Credit notes reverse part or all of an invoice."
          addLabel="Add credit note"
          addTo="/3pl-operations/credit-notes/new"
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(cn) => cn.id}
            loading={isLoading}
            empty="No credit notes yet."
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
