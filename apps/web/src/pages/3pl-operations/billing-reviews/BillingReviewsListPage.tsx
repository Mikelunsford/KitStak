// BillingReviewsListPage (Wave 12 Phase A7). The Billing Review list surface:
// the finance reconciliation step over a completed Job Run, planned estimate
// against realized actual before an invoice is cut. Workstream C of the
// 2026-06-17 UI scan adds the server list toolbar (search on review number,
// sortable headers, status facet, keyset pager, saved views) behind
// feature.list_toolbar. The flag-off path is the original client-state view
// (PageHeader + FilterBar + Select + DataTable + StatusBadge + Pagination),
// extracted verbatim into BillingReviewsListLegacy; the flag-on path is
// BillingReviewsListToolbar. The parent renders one or the other. The estimate
// and actual totals are per-row money columns only (no whole-list rollup), so
// paging the list keeps every figure correct. The create CTA is gated on
// threepl.billing_review.create in both paths; the server is authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { formatCents } from '@/lib/money';
import { useBillingReviewsList } from '@/lib/hooks/useBillingReviews';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listBillingReviewsPage } from '@/lib/services/billingReviewsService';
import { billingReviewsKeys } from '@/lib/queryKeys/threepl';
import { FEATURE_FLAGS } from '@/lib/constants';
import type {
  BillingReview,
  BillingReviewStatus,
} from '@/lib/services/billingReviewsService';

const PAGE_SIZE = 50;

const BILLING_REVIEW_STATUSES: ReadonlyArray<BillingReviewStatus> = [
  'draft',
  'approved',
  'invoiced',
  'cancelled',
];

function reviewMoney(
  cents: number | string | null,
  currency: string | null,
): string {
  if (cents === null) return '·';
  return formatCents(cents, currency ?? 'USD');
}

const COLUMNS: ReadonlyArray<DataColumn<BillingReview>> = [
  {
    key: 'number',
    header: 'Review #',
    cellClassName: 'tabular-nums',
    render: (r) => (
      <Link
        to={`/3pl-operations/billing-reviews/${r.id}`}
        className={LINK_CLASS}
      >
        {r.review_number ?? r.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (r) => <StatusBadge status={r.status} />,
  },
  {
    key: 'estimate',
    header: 'Estimate',
    align: 'right',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (r) => reviewMoney(r.estimate_total_cents, r.currency_code),
  },
  {
    key: 'actual',
    header: 'Actual',
    align: 'right',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (r) => reviewMoney(r.actual_total_cents, r.currency_code),
  },
  {
    key: 'created',
    header: 'Created',
    sortKey: 'created_at',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (r) => r.created_at.slice(0, 10),
  },
];

export function BillingReviewsListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <BillingReviewsListToolbar />
  ) : (
    <BillingReviewsListLegacy />
  );
}

function BillingReviewsListToolbar() {
  const caps = useCapabilities();
  const server = useServerList<BillingReview>({
    enabled: true,
    queryKeyBase: billingReviewsKeys.all,
    fetchPage: listBillingReviewsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'status', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Billing Review"
        actions={
          caps.can('threepl.billing_review.create') ? (
            <Link to="/3pl-operations/billing-reviews/new">
              <Button variant="primary">New billing review</Button>
            </Link>
          ) : null
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search review number"
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
            aria-label="Filter billing reviews by status"
          >
            <option value="">All statuses</option>
            {BILLING_REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="billing_review"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load billing reviews.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(r) => r.id}
            loading={server.isLoading}
            empty="No billing reviews match these filters."
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

function BillingReviewsListLegacy() {
  const [status, setStatus] = useState<BillingReviewStatus | ''>('');
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useBillingReviewsList({
    ...(status ? { status } : {}),
  });
  const caps = useCapabilities();

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const showOnboardingEmpty =
    !isLoading && !error && totalCount === 0 && !status;

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'billing review' : 'billing reviews'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Billing Review"
        meta={meta}
        actions={
          caps.can('threepl.billing_review.create') ? (
            <Link to="/3pl-operations/billing-reviews/new">
              <Button variant="primary">New billing review</Button>
            </Link>
          ) : null
        }
      />

      <FilterBar>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as BillingReviewStatus | '');
            setPage(0);
          }}
          aria-label="Filter billing reviews by status"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="approved">Approved</option>
          <option value="invoiced">Invoiced</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </FilterBar>

      {error ? (
        <p className="font-sans text-accent">Failed to load billing reviews.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="billing review"
          explainer="A billing review reconciles a completed job run before you invoice: the planned estimate against the realized labor and material cost. Approving it cuts a draft invoice on the spine."
          addLabel="Add billing review"
          addTo="/3pl-operations/billing-reviews/new"
          canAdd={caps.can('threepl.billing_review.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(r) => r.id}
            loading={isLoading}
            empty="No billing reviews match this filter."
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
