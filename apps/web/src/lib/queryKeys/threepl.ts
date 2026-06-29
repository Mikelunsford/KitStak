// Query keys for the 3PL commercial layer. Accounts and their per-account
// service definitions (Phase A1); job templates and their builder lines
// (Phase A2). Mirrors the ops.ts key shape (all / list(filters) / detail(id)).

import type { ListAccountsFilters } from '@/lib/services/accountsService';
import type { ListJobTemplatesFilters } from '@/lib/services/jobTemplatesService';
import type { ListSupplyPlansFilters } from '@/lib/services/supplyPlansService';
import type { ListJobRunsFilters } from '@/lib/services/jobRunsService';
import type { ListBillingReviewsFilters } from '@/lib/services/billingReviewsService';
import type { ListJobProfitabilityFilters } from '@/lib/services/jobProfitabilityService';

export const accountsKeys = {
  all: ['threepl', 'accounts'] as const,
  list: (filters: ListAccountsFilters = {}) =>
    [...accountsKeys.all, 'list', filters] as const,
  detail: (id: string) => [...accountsKeys.all, 'detail', id] as const,
};

export const accountServicesKeys = {
  // Service definitions hang off the parent account's detail key so a parent
  // invalidation sweeps them too.
  byAccount: (accountId: string) =>
    [...accountsKeys.detail(accountId), 'services'] as const,
};

export const jobTemplatesKeys = {
  all: ['threepl', 'job_templates'] as const,
  list: (filters: ListJobTemplatesFilters = {}) =>
    [...jobTemplatesKeys.all, 'list', filters] as const,
  detail: (id: string) => [...jobTemplatesKeys.all, 'detail', id] as const,
};

export const jobTemplateLinesKeys = {
  // Builder lines hang off the parent template's detail key so a parent
  // invalidation sweeps them too.
  byTemplate: (templateId: string) =>
    [...jobTemplatesKeys.detail(templateId), 'lines'] as const,
};

export const supplyPlansKeys = {
  all: ['threepl', 'supply_plans'] as const,
  list: (filters: ListSupplyPlansFilters = {}) =>
    [...supplyPlansKeys.all, 'list', filters] as const,
  detail: (id: string) => [...supplyPlansKeys.all, 'detail', id] as const,
};

export const supplyPlanLinesKeys = {
  // Demand lines hang off the parent plan's detail key so a parent
  // invalidation sweeps them too.
  byPlan: (planId: string) =>
    [...supplyPlansKeys.detail(planId), 'lines'] as const,
};

export const jobRunsKeys = {
  all: ['threepl', 'job_runs'] as const,
  list: (filters: ListJobRunsFilters = {}) =>
    [...jobRunsKeys.all, 'list', filters] as const,
  detail: (id: string) => [...jobRunsKeys.all, 'detail', id] as const,
};

export const jobRunDailyLogsKeys = {
  // Daily logs hang off the parent run's detail key so a parent invalidation
  // sweeps them too.
  byRun: (runId: string) =>
    [...jobRunsKeys.detail(runId), 'daily-logs'] as const,
};

export const jobRunDailyLogLinesKeys = {
  // Consumed / produced lines hang off the daily log's key under its run.
  byLog: (runId: string, logId: string) =>
    [...jobRunDailyLogsKeys.byRun(runId), logId, 'lines'] as const,
};

// Job Builder run-scoped build artifacts (ADR 0006 P2). Each hangs off the
// parent run's detail key so a run invalidation sweeps them too. Labels and
// SOW steps are collections; the timeline and jacket are singletons per run.
export const jobRunLabelsKeys = {
  byRun: (runId: string) => [...jobRunsKeys.detail(runId), 'labels'] as const,
};

export const jobRunSowStepsKeys = {
  byRun: (runId: string) => [...jobRunsKeys.detail(runId), 'sow-steps'] as const,
};

export const jobRunTimelineKeys = {
  byRun: (runId: string) => [...jobRunsKeys.detail(runId), 'timeline'] as const,
};

export const jobRunJacketKeys = {
  byRun: (runId: string) => [...jobRunsKeys.detail(runId), 'jacket'] as const,
};

export const billingReviewsKeys = {
  all: ['threepl', 'billing_reviews'] as const,
  list: (filters: ListBillingReviewsFilters = {}) =>
    [...billingReviewsKeys.all, 'list', filters] as const,
  detail: (id: string) => [...billingReviewsKeys.all, 'detail', id] as const,
};

export const jobProfitabilityKeys = {
  all: ['threepl', 'job_profitability'] as const,
  list: (filters: ListJobProfitabilityFilters = {}) =>
    [...jobProfitabilityKeys.all, 'list', filters] as const,
};
