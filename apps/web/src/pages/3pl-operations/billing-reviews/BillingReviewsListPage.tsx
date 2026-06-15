// BillingReviewsListPage (Wave 12 Phase A7). The Billing Review list surface:
// the finance reconciliation step over a completed Job Run, planned estimate
// against realized actual before an invoice is cut. Shared UI kit (PageHeader +
// FilterBar + DataTable + Pagination + StatusBadge) matching the Job Runs /
// Supply Plans list surfaces. The status filter narrows server-side
// (three-pl-api GET /billing-reviews?status=). The create CTA is gated on
// threepl.billing_review.create; the server is authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatCents } from '@/lib/money';
import { useBillingReviewsList } from '@/lib/hooks/useBillingReviews';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import type {
  BillingReview,
  BillingReviewStatus,
} from '@/lib/services/billingReviewsService';

const PAGE_SIZE = 50;

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
    cellClassName: 'font-mono',
    render: (r) => (
      <Link
        to={`/3pl-operations/billing-reviews/${r.id}`}
        className="text-ink hover:text-accent"
      >
        {r.review_number ?? r.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (r) => <StatusBadge status={r.status} />,
  },
  {
    key: 'estimate',
    header: 'Estimate',
    align: 'right',
    cellClassName: 'font-mono text-ink-dim',
    render: (r) => reviewMoney(r.estimate_total_cents, r.currency_code),
  },
  {
    key: 'actual',
    header: 'Actual',
    align: 'right',
    cellClassName: 'font-mono text-ink-dim',
    render: (r) => reviewMoney(r.actual_total_cents, r.currency_code),
  },
  {
    key: 'created',
    header: 'Created',
    cellClassName: 'font-mono text-ink-dim',
    render: (r) => r.created_at.slice(0, 10),
  },
];

export function BillingReviewsListPage() {
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
        eyebrow="3PL Operations"
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
