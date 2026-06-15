// BillingReviewDetailPage (Wave 12 Phase A7). The billing-review hub: the FSM
// transition cluster (approve / cancel) plus the ESTIMATE VS ACTUAL panel.
// Billing review is an FSM but is not registered in the SPA StateStepper paths
// (like the Job Run / Supply Plan / Co-Pack / KitForce FSMs), so the status
// renders as a StatusBadge and the eyebrow is omitted (the FSM detail
// convention). Approve creates the spine draft invoice, lands the review
// approved, and fills invoice_id; a link to that invoice shows once it exists.
//
// Numbers panel: once approved, the review snapshots estimate_total_cents and
// actual_total_cents, so those are the source of truth. For a draft review that
// is job_run-scoped, the snapshot is not yet frozen, so the panel additionally
// fetches the live view_job_profitability row (by job_run_id) to preview
// estimate / actual labor / actual material / billed revenue / margin. Actions
// and the link are gated by state and the matching capabilities; the server is
// authority.

import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { formatCents } from '@/lib/money';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import {
  useBillingReview,
  useApproveBillingReview,
  useCancelBillingReview,
  useJobProfitability,
} from '@/lib/hooks/useBillingReviews';
import type { JobProfitabilityRow } from '@/lib/services/jobProfitabilityService';

function money(cents: number | string | null, currency: string | null): string {
  if (cents === null) return '·';
  return formatCents(cents, currency ?? 'USD');
}

// One label / value row in the numbers panel. marginNegative paints the value
// accent (over budget) when the margin reads negative.
function NumberRow({
  label,
  value,
  marginNegative,
}: {
  label: string;
  value: string;
  marginNegative?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-line py-2">
      <span className="font-sans text-sm uppercase tracking-wide text-ink-dim">
        {label}
      </span>
      <span
        className={`font-mono ${marginNegative ? 'text-accent' : 'text-ink'}`}
      >
        {value}
      </span>
    </div>
  );
}

// Live preview of the profitability view for a draft job-run-scoped review, so
// the operator sees the realized roll-up before approving (and freezing the
// snapshot). Mounted only when the review is a draft tied to a job run.
function LiveProfitabilityPreview({
  jobRunId,
  currency,
}: {
  jobRunId: string;
  currency: string | null;
}) {
  const { data, isLoading, error } = useJobProfitability({ job_run_id: jobRunId });
  const row: JobProfitabilityRow | undefined = (data ?? [])[0];

  if (isLoading) {
    return <p className="text-sm text-ink-dim">Loading live figures.</p>;
  }
  if (error) {
    return (
      <p className="font-sans text-sm text-accent">
        Failed to load live profitability.
      </p>
    );
  }
  if (!row) {
    return (
      <p className="text-sm text-ink-dim">
        No live figures yet. They populate as the job run posts daily logs.
      </p>
    );
  }

  const marginNegative = Number(row.margin_cents) < 0;

  return (
    <div className="flex flex-col">
      <NumberRow label="Estimate" value={money(row.estimate_total_cents, currency)} />
      <NumberRow label="Actual labor" value={money(row.actual_labor_cents, currency)} />
      <NumberRow
        label="Actual material"
        value={money(row.actual_material_cents, currency)}
      />
      <NumberRow label="Actual total" value={money(row.actual_total_cents, currency)} />
      <NumberRow
        label="Billed revenue"
        value={money(row.billed_revenue_cents, currency)}
      />
      <NumberRow
        label="Margin"
        value={money(row.margin_cents, currency)}
        marginNegative={marginNegative}
      />
    </div>
  );
}

export function BillingReviewDetailPage() {
  const { id } = useParams();
  const reviewId = id ?? '';
  const { data: review, isLoading, error } = useBillingReview(id);
  const approve = useApproveBillingReview(reviewId);
  const cancel = useCancelBillingReview(reviewId);
  const caps = useCapabilities();

  if (isLoading) return <p className="p-8 text-ink-dim">Loading.</p>;
  if (error || !review)
    return <p className="p-8 text-accent">Billing review not found.</p>;

  const isDraft = review.status === 'draft';
  const isApproved = review.status === 'approved';
  const canApprove = isDraft && caps.can('threepl.billing_review.approve');
  const canCancel =
    (isDraft || isApproved) && caps.can('threepl.billing_review.cancel');
  const transitionError = approve.error ?? cancel.error;

  // Snapshot figures are frozen once approved; show them whenever present.
  const hasSnapshot =
    review.estimate_total_cents !== null || review.actual_total_cents !== null;

  const onApprove = async () => {
    const ok = await destructiveConfirm({
      action: 'Approve this billing review',
      consequence:
        'Approving snapshots the estimate and actual figures and cuts a draft invoice on the spine. The review moves to approved.',
    });
    if (!ok) return;
    approve.mutate();
  };

  const onCancel = async () => {
    const ok = await destructiveConfirm({
      action: 'Cancel this billing review',
      consequence:
        'The review moves to cancelled. Any draft invoice already cut on the spine is not removed.',
    });
    if (!ok) return;
    cancel.mutate();
  };

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-12">
      <PageHeader
        title={review.review_number ?? review.id.slice(0, 8)}
        meta={
          <span className="flex flex-col gap-2">
            <span>
              <StatusBadge status={review.status} />
            </span>
            {review.job_run_id && (
              <span className="text-sm">
                Job run:{' '}
                <Link
                  to={`/3pl-operations/job-runs/${review.job_run_id}`}
                  className="text-ink hover:text-accent font-mono"
                  data-testid="billing-review-job-run-link"
                >
                  {review.job_run_id.slice(0, 8)}
                </Link>
              </span>
            )}
            {review.project_id && (
              <span className="text-sm">
                Project:{' '}
                <Link
                  to={`/projects/${review.project_id}`}
                  className="text-ink hover:text-accent font-mono"
                  data-testid="billing-review-project-link"
                >
                  {review.project_id.slice(0, 8)}
                </Link>
              </span>
            )}
            {review.account_id && (
              <span className="text-sm">
                Account:{' '}
                <Link
                  to={`/3pl-operations/accounts/${review.account_id}`}
                  className="text-ink hover:text-accent font-mono"
                  data-testid="billing-review-account-link"
                >
                  {review.account_id.slice(0, 8)}
                </Link>
              </span>
            )}
            {review.invoice_id && (
              <span className="text-sm">
                Invoice:{' '}
                <Link
                  to={`/invoicing/invoices/${review.invoice_id}`}
                  className="text-ink hover:text-accent font-mono"
                  data-testid="billing-review-invoice-link"
                >
                  {review.invoice_id.slice(0, 8)}
                </Link>
              </span>
            )}
          </span>
        }
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
              HISTORY
            </h2>
            <AuditTimeline entityType="billing_review" entityId={id ?? null} />
          </section>
        }
      >
        <div className="flex flex-wrap gap-2">
          {canApprove && (
            <Button onClick={onApprove} disabled={approve.isPending}>
              {approve.isPending ? 'Approving.' : 'Approve and cut invoice'}
            </Button>
          )}
          {canCancel && (
            <Button
              variant="secondary"
              disabled={cancel.isPending}
              onClick={onCancel}
            >
              {cancel.isPending ? 'Cancelling.' : 'Cancel review'}
            </Button>
          )}
        </div>
        {transitionError && (
          <p className="font-sans text-sm text-accent">
            {transitionError instanceof Error
              ? transitionError.message
              : 'Action failed.'}
          </p>
        )}

        <section>
          <h2 className="mb-3 text-2xl font-display tracking-wider text-ink">
            ESTIMATE VS ACTUAL
          </h2>
          {hasSnapshot ? (
            <div className="flex flex-col">
              <NumberRow
                label="Estimate"
                value={money(review.estimate_total_cents, review.currency_code)}
              />
              <NumberRow
                label="Actual"
                value={money(review.actual_total_cents, review.currency_code)}
              />
            </div>
          ) : review.job_run_id ? (
            <LiveProfitabilityPreview
              jobRunId={review.job_run_id}
              currency={review.currency_code}
            />
          ) : (
            <p className="text-sm text-ink-dim">
              Figures snapshot when the review is approved. This draft is not
              tied to a job run, so there are no live figures to preview.
            </p>
          )}
        </section>

        {review.notes && (
          <section>
            <h2 className="mb-3 text-2xl font-display tracking-wider text-ink">
              NOTES
            </h2>
            <p className="font-sans text-ink">{review.notes}</p>
          </section>
        )}
      </DetailLayout>
    </section>
  );
}
