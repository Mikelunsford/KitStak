// InvoicesListPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01):
// PageHeader + FilterBar + Select + DataTable + StatusBadge + Pagination
// replace the hand-rolled header, raw status text, the button-grid status
// filter, the hand-rolled table, and the hand-rolled pager. Behavior
// preserved: the ?status= deep-link from the dashboard work card still seeds
// the status filter; invalid values fall back to the full list, and the
// filter is held in local state so the operator can change it via the Select.

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
import { useInvoices } from '@/lib/hooks/useInvoices';
import { formatCents } from '@/lib/money';
import type { Invoice } from '@/lib/types/finance';

import { formatInvoiceAging } from './invoiceAging';

const PAGE_SIZE = 50;

// Invoice statuses the list accepts via ?status=. Ordered for the filter
// dropdown; mirrors the allow-set below so an arbitrary string never reaches
// the wire.
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
    cellClassName: 'font-mono',
    render: (inv) => (
      <Link
        to={`/invoicing/invoices/${inv.id}`}
        className="text-ink hover:text-accent"
      >
        {inv.invoice_number}
      </Link>
    ),
  },
  {
    key: 'customer',
    header: 'Customer',
    cellClassName: 'text-ink-dim',
    render: (inv) =>
      inv.customer_id ? (
        <EntityLabel kind="customer" id={inv.customer_id} />
      ) : (
        '.'
      ),
  },
  {
    key: 'project',
    header: 'Project',
    cellClassName: 'text-ink-dim',
    render: (inv) =>
      inv.project_id ? (
        <EntityLabel kind="project" id={inv.project_id} />
      ) : (
        '.'
      ),
  },
  {
    key: 'status',
    header: 'Status',
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
    cellClassName: 'font-mono',
    render: (inv) =>
      formatCents(inv.total_cents as number | string, inv.currency_code),
  },
  {
    key: 'balance',
    header: 'Balance',
    align: 'right',
    cellClassName: 'font-mono',
    render: (inv) =>
      formatCents(inv.balance_cents as number | string, inv.currency_code),
  },
];

/**
 * InvoicesListPage. Lists invoices in the active org. Status filter, paginated
 * through TanStack Query. The full ledger view ships with sorting and customer
 * filter in a later wave; Wave 2 focuses on chassis correctness.
 *
 * UX-Q5: accepts ?status= deep-links from the dashboard work card
 * ("Unpaid invoices" -> ?status=sent). The filter is captured into local
 * state on mount so the operator can change it via the Select.
 */
export function InvoicesListPage() {
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
