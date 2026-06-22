// PaymentsListPage. Workstream C of the 2026-06-17 UI scan adds the server list
// toolbar (search, sortable headers, keyset pager, saved views) behind
// feature.list_toolbar. The flag-off path is the original client-slice inflow
// ledger, extracted verbatim into PaymentsListLegacy; the flag-on path is
// PaymentsListToolbar. The parent renders one or the other.
//
// Payments have no state machine surfaced here, so there is no status facet and
// no enum filter (mirroring the legacy view, which never had a FilterBar). The
// toolbar offers free-text search on the payment number plus sortable headers.
// Behavior preserved: the number cell still deep-links to the invoicing apply
// route, and the create CTA still targets /invoicing/payments/new.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { usePayments } from '@/lib/hooks/usePayments';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listPaymentsPage } from '@/lib/services/paymentsService';
import { paymentKeys } from '@/lib/queryKeys/payments';
import { FEATURE_FLAGS } from '@/lib/constants';
import { formatCents } from '@/lib/money';
import type { Payment } from '@/lib/types/finance';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<Payment>> = [
  {
    key: 'number',
    header: 'Number',
    sortKey: 'payment_number',
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
    sortKey: 'received_at',
    cellClassName: 'text-ink-dim',
    render: (p) => new Date(p.received_at).toLocaleDateString(),
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    sortKey: 'amount_cents',
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

export function PaymentsListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <PaymentsListToolbar />
  ) : (
    <PaymentsListLegacy />
  );
}

function PaymentsListToolbar() {
  const server = useServerList<Payment>({
    enabled: true,
    queryKeyBase: paymentKeys.all,
    fetchPage: listPaymentsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Payments"
        actions={
          <Link to="/invoicing/payments/new">
            <Button variant="primary">New payment</Button>
          </Link>
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search payment number"
        chips={server.chips}
        onClearAll={server.clearAll}
      />

      <SavedViewsBar
        entityType="payment"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load payments.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(p) => p.id}
            loading={server.isLoading}
            empty="No payments match these filters."
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

/**
 * PaymentsListLegacy. Inflow ledger by received_at desc (client slice).
 */
function PaymentsListLegacy() {
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
