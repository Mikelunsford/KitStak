// ProfitabilityPage (Wave 12 Phase A7). The Job Profitability report: one row
// per Job Run rolling the planned estimate against realized labor and material
// cost and billed revenue. Read-only (view_job_profitability), so no create CTA
// and no FSM. Shared UI kit (PageHeader + DataTable). Gated on
// threepl.profitability.read; the server is authority, the SPA mirrors the gate
// to keep the surface honest. Margin is colored: negative reads accent (over
// budget), positive reads green.

import { Link } from 'react-router-dom';

import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { formatCents } from '@/lib/money';
import { useJobProfitability } from '@/lib/hooks/useBillingReviews';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import type { JobProfitabilityRow } from '@/lib/services/jobProfitabilityService';

// The view does not snapshot a currency per row, so the report renders in the
// org reporting currency (USD). The cents are the canonical store; this is a
// display choice only.
const REPORT_CURRENCY = 'USD';

function money(cents: number | string): string {
  return formatCents(cents, REPORT_CURRENCY);
}

const COLUMNS: ReadonlyArray<DataColumn<JobProfitabilityRow>> = [
  {
    key: 'job_run',
    header: 'Job run',
    cellClassName: 'font-mono',
    render: (r) => (
      <Link
        to={`/3pl-operations/job-runs/${r.job_run_id}`}
        className="text-ink hover:text-accent"
      >
        {r.job_run_id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'estimate',
    header: 'Estimate',
    align: 'right',
    cellClassName: 'font-mono text-ink-dim',
    render: (r) => money(r.estimate_total_cents),
  },
  {
    key: 'labor',
    header: 'Actual labor',
    align: 'right',
    cellClassName: 'font-mono text-ink-dim',
    render: (r) => money(r.actual_labor_cents),
  },
  {
    key: 'material',
    header: 'Actual material',
    align: 'right',
    cellClassName: 'font-mono text-ink-dim',
    render: (r) => money(r.actual_material_cents),
  },
  {
    key: 'revenue',
    header: 'Billed revenue',
    align: 'right',
    cellClassName: 'font-mono text-ink-dim',
    render: (r) => money(r.billed_revenue_cents),
  },
  {
    key: 'margin',
    header: 'Margin',
    align: 'right',
    render: (r) => {
      const negative = Number(r.margin_cents) < 0;
      return (
        <span className={`font-mono ${negative ? 'text-accent' : 'text-green-500'}`}>
          {money(r.margin_cents)}
        </span>
      );
    },
  },
];

export function ProfitabilityPage() {
  const caps = useCapabilities();
  const canRead = caps.can('threepl.profitability.read');
  const { data, isLoading, error } = useJobProfitability();

  const rows = data ?? [];
  const meta =
    !isLoading && !error && canRead
      ? `${rows.length} ${rows.length === 1 ? 'job run' : 'job runs'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="3PL Operations" title="Profitability" meta={meta} />

      {!canRead ? (
        <p className="font-sans text-sm text-ink-dim">
          You do not have permission to view job profitability.
        </p>
      ) : error ? (
        <p className="font-sans text-accent">Failed to load profitability.</p>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          getRowKey={(r) => r.job_run_id}
          loading={isLoading}
          empty="No job profitability yet. Rows populate as job runs post work and get billed."
        />
      )}
    </section>
  );
}
