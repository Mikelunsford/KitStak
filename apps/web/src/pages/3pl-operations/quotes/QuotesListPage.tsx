// QuotesListPage. Workstream C of the 2026-06-17 UI scan adds a server-driven
// list toolbar (debounced search, sortable headers, status facet, keyset
// pager) behind feature.list_toolbar. The flag-off path is the original
// client-slice view, extracted verbatim into QuotesListLegacy so it is
// byte-identical; the flag-on path is QuotesListToolbar. The parent renders one
// or the other, so only the active path runs its hooks and fetch.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
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
import { useQuotesList } from '@/lib/hooks/useQuotes';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listQuotesPage } from '@/lib/services/quotesService';
import { quotesKeys } from '@/lib/queryKeys/quotes';
import { FEATURE_FLAGS } from '@/lib/constants';
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

// Shared columns. sortKey marks the server-sortable columns (the toolbar view
// passes onSort; the legacy view does not, so sortKey is simply ignored there).
const COLUMNS: ReadonlyArray<DataColumn<Quote>> = [
  {
    key: 'number',
    header: 'Number',
    sortKey: 'number',
    cellClassName: 'font-mono',
    render: (q) => (
      <Link to={`/quotes/${q.id}`} className="text-ink hover:text-accent">
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
    sortKey: 'state',
    render: (q) => <StatusBadge status={q.state} />,
  },
  {
    key: 'total',
    header: 'Total',
    align: 'right',
    sortKey: 'total_cents',
    cellClassName: 'font-mono',
    render: (q) => formatCents(q.total_cents, q.currency_code),
  },
];

export function QuotesListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <QuotesListToolbar />
  ) : (
    <QuotesListLegacy />
  );
}

function QuotesListToolbar() {
  const server = useServerList<Quote>({
    enabled: true,
    queryKeyBase: quotesKeys.all,
    fetchPage: listQuotesPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'state', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Quotes"
        title="Quotes"
        actions={
          <Link to="/quotes/new">
            <Button variant="primary">New quote</Button>
          </Link>
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search number or title"
        chips={server.chips}
        onClearAll={server.clearAll}
      >
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Status
          </span>
          <Select
            value={server.facetValues.state ?? ''}
            onChange={(e) => server.setFacet('state', e.target.value)}
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
      </ListToolbar>

      <SavedViewsBar
        entityType="quote"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load quotes.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(q) => q.id}
            loading={server.isLoading}
            empty="No quotes match these filters."
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

function QuotesListLegacy() {
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
