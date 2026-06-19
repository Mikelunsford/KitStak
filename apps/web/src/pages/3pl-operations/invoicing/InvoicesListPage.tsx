// InvoicesListPage. Workstream C of the 2026-06-17 UI scan adds the server
// list toolbar (search, sortable headers, status facet, open-balance toggle,
// overdue facet, keyset pager) behind feature.list_toolbar. The flag-off path
// is the original client-slice view, extracted verbatim into InvoicesListLegacy;
// the flag-on path is InvoicesListToolbar. The parent renders one or the other.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
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
import { useInvoices } from '@/lib/hooks/useInvoices';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listInvoicesPage } from '@/lib/services/invoicesService';
import { invoiceKeys } from '@/lib/queryKeys/invoices';
import { FEATURE_FLAGS } from '@/lib/constants';
import { formatCents } from '@/lib/money';
import type { Invoice } from '@/lib/types/finance';

import { formatInvoiceAging } from './invoiceAging';

const PAGE_SIZE = 50;

const INVOICE_STATUSES = [
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
] as const;

const ALLOWED_INVOICE_STATUSES = new Set<string>(INVOICE_STATUSES);

function parseInvoiceStatusParam(raw: string | null): string | undefined {
  if (raw && ALLOWED_INVOICE_STATUSES.has(raw)) return raw;
  return undefined;
}

const COLUMNS: ReadonlyArray<DataColumn<Invoice>> = [
  {
    key: 'number',
    header: 'Number',
    sortKey: 'invoice_number',
    cellClassName: 'tabular-nums',
    render: (inv) => (
      <Link to={`/invoicing/invoices/${inv.id}`} className={LINK_CLASS}>
        {inv.invoice_number}
      </Link>
    ),
  },
  {
    key: 'customer',
    header: 'Customer',
    cellClassName: 'text-ink-dim',
    render: (inv) =>
      inv.customer_id ? <EntityLabel kind="customer" id={inv.customer_id} /> : '.',
  },
  {
    key: 'project',
    header: 'Project',
    cellClassName: 'text-ink-dim',
    render: (inv) =>
      inv.project_id ? <EntityLabel kind="project" id={inv.project_id} /> : '.',
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (inv) => <StatusBadge status={inv.status} />,
  },
  {
    key: 'issue_date',
    header: 'Issue date',
    cellClassName: 'text-ink-dim',
    render: (inv) => inv.issue_date ?? '.',
  },
  {
    key: 'aging',
    header: 'Aging',
    cellClassName: 'text-ink-dim',
    render: (inv) =>
      formatInvoiceAging({
        status: inv.status,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
      }),
  },
  {
    key: 'total',
    header: 'Total',
    align: 'right',
    sortKey: 'total_cents',
    cellClassName: 'tabular-nums',
    render: (inv) =>
      formatCents(inv.total_cents as number | string, inv.currency_code),
  },
  {
    key: 'balance',
    header: 'Balance',
    align: 'right',
    cellClassName: 'tabular-nums',
    render: (inv) =>
      formatCents(inv.balance_cents as number | string, inv.currency_code),
  },
];

export function InvoicesListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <InvoicesListToolbar />
  ) : (
    <InvoicesListLegacy />
  );
}

function InvoicesListToolbar() {
  const server = useServerList<Invoice>({
    enabled: true,
    queryKeyBase: invoiceKeys.all,
    fetchPage: listInvoicesPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [
      { key: 'status', label: 'Status', format: humaniseStatus },
      { key: 'open_balance', label: 'Open balance', toggle: true },
      { key: 'overdue', label: 'Overdue', toggle: true },
    ],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Invoicing / Invoices"
        title="Invoices"
        actions={
          <Link to="/invoicing/invoices/new">
            <Button variant="primary">New invoice</Button>
          </Link>
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search invoice number"
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
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 font-sans text-sm text-ink-dim">
          <input
            type="checkbox"
            checked={server.facetValues.open_balance === 'true'}
            onChange={(e) => server.setFacet('open_balance', e.target.checked ? 'true' : '')}
          />
          Open balance
        </label>
        <label className="flex items-center gap-2 font-sans text-sm text-ink-dim">
          <input
            type="checkbox"
            checked={server.facetValues.overdue === 'true'}
            onChange={(e) => server.setFacet('overdue', e.target.checked ? 'true' : '')}
          />
          Overdue
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="invoice"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load invoices.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(inv) => inv.id}
            loading={server.isLoading}
            empty="No invoices match these filters."
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

function InvoicesListLegacy() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<string | undefined>(() =>
    parseInvoiceStatusParam(searchParams.get('status')),
  );
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = useInvoices(status ? { status } : {});

  function applyStatusFilter(next: string) {
    setStatus(next || undefined);
    setPage(0);
  }

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const chips: FilterChip[] = status
    ? [
        {
          key: 'status',
          label: `Status: ${humaniseStatus(status)}`,
          onClear: () => applyStatusFilter(''),
        },
      ]
    : [];

  const showOnboardingEmpty =
    !isLoading && !error && !status && totalCount === 0;

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'invoice' : 'invoices'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Invoicing / Invoices"
        title="Invoices"
        meta={meta}
        actions={
          <Link to="/invoicing/invoices/new">
            <Button variant="primary">New invoice</Button>
          </Link>
        }
      />

      <FilterBar chips={chips}>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Status
          </span>
          <Select
            value={status ?? ''}
            onChange={(e) => applyStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      {error ? (
        <p className="font-sans text-accent">Failed to load invoices.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="invoice"
          explainer="Invoices bill a customer for delivered work."
          addLabel="Add invoice"
          addTo="/invoicing/invoices/new"
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(inv) => inv.id}
            loading={isLoading}
            empty="No invoices match this filter."
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
