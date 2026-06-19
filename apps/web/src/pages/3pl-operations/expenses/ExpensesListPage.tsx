// ExpensesListPage. Workstream C of the 2026-06-17 UI scan adds the server list
// toolbar (search on expense number, sortable headers, status facet, keyset
// pager, saved views) behind feature.list_toolbar. The flag-off path is the
// original client-state view (the F-Wave10-UI-KIT-01 migration: PageHeader +
// DataTable + StatusBadge + Pagination), extracted verbatim into
// ExpensesListLegacy; the flag-on path is ExpensesListToolbar. The parent
// renders one or the other.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useExpensesList } from '@/lib/hooks/useExpenses';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listExpensesPage } from '@/lib/services/expensesService';
import { expensesKeys } from '@/lib/queryKeys/expenses';
import { FEATURE_FLAGS } from '@/lib/constants';
import { formatCents } from '@/lib/money';
import type { Expense } from '@/lib/types/vendors_inventory_ops';

const PAGE_SIZE = 50;

// Expense statuses the list accepts via the toolbar status facet. Ordered for
// the dropdown; an arbitrary string never reaches the facet state.
const EXPENSE_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'paid',
  'reimbursed',
  'rejected',
] as const;

const COLUMNS: ReadonlyArray<DataColumn<Expense>> = [
  {
    key: 'number',
    header: '#',
    cellClassName: 'tabular-nums',
    render: (e) => (
      <Link to={`/purchasing/expenses/${e.id}`} className={LINK_CLASS}>
        {e.expense_number ?? e.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (e) => <StatusBadge status={e.status} />,
  },
  {
    key: 'date',
    header: 'Date',
    sortKey: 'expense_date',
    cellClassName: 'text-ink-dim',
    render: (e) => e.expense_date,
  },
  {
    key: 'total',
    header: 'Total',
    align: 'right',
    cellClassName: 'tabular-nums',
    render: (e) =>
      formatCents(e.total_cents as number | string, e.currency_code),
  },
];

export function ExpensesListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <ExpensesListToolbar />
  ) : (
    <ExpensesListLegacy />
  );
}

function ExpensesListToolbar() {
  const caps = useVioCapabilities();
  const server = useServerList<Expense>({
    enabled: true,
    queryKeyBase: expensesKeys.all,
    fetchPage: listExpensesPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'status', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Purchasing / Expenses"
        title="Expenses"
        actions={
          caps.can('expenses.expense.create') ? (
            <Link to="/purchasing/expenses/new">
              <Button variant="primary">New expense</Button>
            </Link>
          ) : undefined
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search expense number"
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
            {EXPENSE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="expense"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load expenses.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(e) => e.id}
            loading={server.isLoading}
            empty="No expenses match these filters."
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

function ExpensesListLegacy() {
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
