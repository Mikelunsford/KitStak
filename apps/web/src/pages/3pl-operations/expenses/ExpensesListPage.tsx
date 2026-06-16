// ExpensesListPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01, 3PL
// CRUD tail): PageHeader + DataTable + StatusBadge + Pagination replace the
// hand-rolled header, the raw status pill, and the hand-rolled table. Behavior
// preserved: the create CTA stays gated on expenses.expense.create and the
// onboarding ListEmptyState still renders on a true empty list.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useExpensesList } from '@/lib/hooks/useExpenses';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatCents } from '@/lib/money';
import type { Expense } from '@/lib/types/vendors_inventory_ops';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<Expense>> = [
  {
    key: 'number',
    header: '#',
    cellClassName: 'font-mono',
    render: (e) => (
      <Link
        to={`/purchasing/expenses/${e.id}`}
        className="text-ink hover:text-accent"
      >
        {e.expense_number ?? e.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (e) => <StatusBadge status={e.status} />,
  },
  {
    key: 'date',
    header: 'Date',
    cellClassName: 'text-ink-dim',
    render: (e) => e.expense_date,
  },
  {
    key: 'total',
    header: 'Total',
    align: 'right',
    cellClassName: 'font-mono',
    render: (e) =>
      formatCents(e.total_cents as number | string, e.currency_code),
  },
];

export function ExpensesListPage() {
  const { data, isLoading, error } = useExpensesList();
  const caps = useVioCapabilities();
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'expense' : 'expenses'}`
      : undefined;

  const showOnboardingEmpty = !isLoading && !error && totalCount === 0;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Purchasing / Expenses"
        title="Expenses"
        meta={meta}
        actions={
          caps.can('expenses.expense.create') ? (
            <Link to="/purchasing/expenses/new">
              <Button variant="primary">New expense</Button>
            </Link>
          ) : undefined
        }
      />

      {error ? (
        <p className="font-sans text-accent">Failed to load expenses.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="expense"
          explainer="Expenses are operating costs outside of vendor bills."
          addLabel="Add expense"
          addTo="/purchasing/expenses/new"
          canAdd={caps.can('expenses.expense.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(e) => e.id}
            loading={isLoading}
            empty="No expenses yet."
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
