// 3PL Job Profitability read service (Wave 12 Phase A7). Lives under the
// plugin-gated three-pl-api bundle (plugins.three_pl), sibling to
// billingReviewsService.
//
// view_job_profitability is a read-only view: one row per Job Run rolling the
// planned estimate against realized labor and material cost and billed revenue.
// margin_cents is billed_revenue_cents minus actual_total_cents and CAN be
// negative. Read-only, so no writes and no Idempotency-Key.

import { apiRequest } from '@/lib/apiClient';
import {
  JobProfitabilityRowSchema,
  type JobProfitabilityRow,
} from '@/lib/types/threepl';

export type { JobProfitabilityRow };

const BASE = '/three-pl-api/profitability';

export type ListJobProfitabilityFilters = {
  job_run_id?: string;
  project_id?: string;
};

function jobProfitabilityQs(f: ListJobProfitabilityFilters): string {
  const p = new URLSearchParams();
  if (f.job_run_id) p.set('job_run_id', f.job_run_id);
  if (f.project_id) p.set('project_id', f.project_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listJobProfitability(
  filters: ListJobProfitabilityFilters = {},
): Promise<JobProfitabilityRow[]> {
  const data = await apiRequest<unknown>(
    `${BASE}${jobProfitabilityQs(filters)}`,
    { method: 'GET' },
  );
  return (data as JobProfitabilityRow[]).map((r) =>
    JobProfitabilityRowSchema.parse(r),
  );
}
