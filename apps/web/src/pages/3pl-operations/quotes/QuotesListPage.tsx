// QuotesListPage. Reference migration to the shared UI kit (F-Wave10-UI-KIT-01):
// PageHeader + FilterBar + Select + DataTable + StatusBadge + Pagination
// replace the hand-rolled header, status text, table, and (previously absent)
// pagination. Behavior preserved: the ?state deep-link from the dashboard work
// card still filters the list; invalid values fall back to the full list.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, type FilterChip } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useQuotesList } from '@/lib/hooks/useQuotes';
import { formatCents } from '@/lib/money';
import type { Quote } from '@/lib/types/sales';

const PAGE_SIZE = 50;

// Quote states the list accepts via ?state=. Ordered for the filter dropdown;
// mirrors QuoteStateSchema so an arbitrary string never reaches the wire.
const QUOTE_STATES = [
  'draft',
  'submitted',
  'revise_requested',
  'approved',
  'project_pending',
  'cancelled',
] as const;

const ALLOWED_QUOTE_STATES = new Set<string>(QUOTE_STATES);

function parseStateParam(raw: string | null): string | undefined {
  if (!raw) return undefined;
  return ALLOWED_QUOTE_STATES.has(raw) ? raw : undefined;
}

const COLUMNS: ReadonlyArray<DataColumn<Quote>> = [
  {
    key: 'number',
    header: 'Number',
    cellClassName: 'font-mono',
    render: (q) => (
      <Link
        to={`/quotes/${q.id}`}
        className="text-ink hover:text-accent"
      >
        {q.number}
      </Link>
    ),
  },
  {
    key: 'title',
    header: 'Title',
    render: (q) => q.title ?? '.',
  },
  {
    key: 'customer',
    header: 'Customer',
    cellClassName: 'text-ink-dim',
    render: (q) =>
      q.customer_id ? <EntityLabel kind="customer" id={q.customer_id} /> : '.',
  },
  {
    key: 'project',
    header: 'Project',
    cellClassName: 'text-ink-dim',
    render: (q) =>
      q.converted_to_project_id ? (
        <EntityLabel kind="project" id={q.converted_to_project_id} />
      ) : (
        '.'
      ),
  },
  {
    key: 'state',
    header: 'Status',
    render: (q) => <StatusBadge status={q.state} />,
  },
  {
    key: 'total',
    header: 'Total',
    align: 'right',
    cellClassName: 'font-mono',
    render: (q) => formatCents(q.total_cents, q.currency_code),
  },
];

export function QuotesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const stateFilter = parseStateParam(searchParams.get('state'));
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useQuotesList(
    stateFilter ? { state: stateFilter } : {},
  );

  function applyStateFilter(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('state', next);
    else params.delete('state');
    setSearchParams(params, { replace: true });
    setPage(0);
  }

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const chips: FilterChip[] = stateFilter
    ? [
        {
          key: 'state',
          label: `Status: ${humaniseStatus(stateFilter)}`,
          onClear: () => applyStateFilter(''),
        },
      ]
    : [];

  const showOnboardingEmpty =
    !isLoading && !error && !stateFilter && totalCount === 0;

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'quote' : 'quotes'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Quotes"
        title="Quotes"
        meta={meta}
        actions={
          <Link to="/quotes/new">
            <Button variant="primary">New quote</Button>
          </Link>
        }
      />

      <FilterBar chips={chips}>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Status
          </span>
          <Select
            value={stateFilter ?? ''}
            onChange={(e) => applyStateFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {QUOTE_STATES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      {error ? (
        <p className="font-sans text-accent">Failed to load quotes.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="quote"
          explainer="Quotes are priced proposals for a customer order."
          addLabel="Add quote"
          addTo="/quotes/new"
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(q) => q.id}
            loading={isLoading}
            empty="No quotes match this filter."
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
