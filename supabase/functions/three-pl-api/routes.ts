// three-pl-api route table. One entry per HTTP verb plus path, matched by the
// shared route dispatcher (METHOD_NOT_ALLOWED / NOT_FOUND fall-through). Order
// and paths are byte-for-byte the order the former monolithic index.ts TABLE
// declared, so dispatch behaviour is unchanged after the R-W13-DX-01 split.

import type { Route } from '../_shared/route.ts';
import {
  listAccounts, createAccount, getAccount, patchAccount, deleteAccount,
  deactivateAccount, reactivateAccount,
  listAccountServices, createAccountService, patchAccountService, deleteAccountService,
} from './handlers/accounts.ts';
import {
  listJobTemplates, createJobTemplate, getJobTemplate, patchJobTemplate,
  deleteJobTemplate, deactivateJobTemplate, reactivateJobTemplate,
  listJobTemplateLines, createJobTemplateLine, patchJobTemplateLine, deleteJobTemplateLine,
} from './handlers/job_templates.ts';
import {
  listSupplyPlans, createSupplyPlan, getSupplyPlan, patchSupplyPlan, deleteSupplyPlan,
  releaseSupplyPlan, cancelSupplyPlan, fulfillSupplyPlan,
  listSupplyPlanLines, createSupplyPlanLine, patchSupplyPlanLine, deleteSupplyPlanLine,
} from './handlers/supply_plans.ts';
import {
  listJobRuns, createJobRun, getJobRun, patchJobRun, deleteJobRun,
  startJobRun, completeJobRun, closeJobRun, cancelJobRun,
  listJobRunDailyLogs, createJobRunDailyLog, getJobRunDailyLog, patchJobRunDailyLog,
  deleteJobRunDailyLog, postJobRunDailyLog,
  listConsumedLines, createConsumedLine, patchConsumedLine, deleteConsumedLine,
  listProducedLines, createProducedLine, patchProducedLine, deleteProducedLine,
} from './handlers/job_runs.ts';
import {
  listJobRunLabels, createJobRunLabel, patchJobRunLabel, deleteJobRunLabel,
  listJobRunSowSteps, createJobRunSowStep, patchJobRunSowStep, deleteJobRunSowStep,
  getJobRunTimeline, upsertJobRunTimeline,
  getJobRunJacket, ensureJobRunJacket, transitionJobRunJacket,
} from './handlers/job_artifacts.ts';
import { buildJobFromQuote } from './handlers/build_from_quote.ts';
import {
  listBillingReviews, createBillingReview, getBillingReview, patchBillingReview,
  deleteBillingReview, approveBillingReview, cancelBillingReview,
} from './handlers/billing_reviews.ts';
import {
  listProfitability, getProfitability,
} from './handlers/profitability.ts';

export const routes: Route[] = [
  // -------------------------------------------------------------------------
  // three_pl_accounts (parent; active / inactive flag, no rich FSM)
  // -------------------------------------------------------------------------
  { method: 'GET',    path: '/accounts',                  handler: listAccounts },
  { method: 'POST',   path: '/accounts',                  handler: createAccount },
  { method: 'GET',    path: '/accounts/:id',              handler: getAccount },
  { method: 'PATCH',  path: '/accounts/:id',              handler: patchAccount },
  { method: 'DELETE', path: '/accounts/:id',              handler: deleteAccount },
  { method: 'POST',   path: '/accounts/:id/deactivate',   handler: deactivateAccount },
  { method: 'POST',   path: '/accounts/:id/reactivate',   handler: reactivateAccount },

  // account_service_definitions (per-account Rate Card overlay)
  { method: 'GET',    path: '/accounts/:id/services',       handler: listAccountServices },
  { method: 'POST',   path: '/accounts/:id/services',       handler: createAccountService },
  { method: 'PATCH',  path: '/accounts/:id/services/:sid',  handler: patchAccountService },
  { method: 'DELETE', path: '/accounts/:id/services/:sid',  handler: deleteAccountService },

  // -------------------------------------------------------------------------
  // job_templates (parent; the Job Builder engine; active / inactive flag)
  // -------------------------------------------------------------------------
  { method: 'GET',    path: '/job-templates',                 handler: listJobTemplates },
  { method: 'POST',   path: '/job-templates',                 handler: createJobTemplate },
  { method: 'GET',    path: '/job-templates/:id',             handler: getJobTemplate },
  { method: 'PATCH',  path: '/job-templates/:id',             handler: patchJobTemplate },
  { method: 'DELETE', path: '/job-templates/:id',             handler: deleteJobTemplate },
  { method: 'POST',   path: '/job-templates/:id/deactivate',  handler: deactivateJobTemplate },
  { method: 'POST',   path: '/job-templates/:id/reactivate',  handler: reactivateJobTemplate },

  // job_template_lines (child; builder definition lines)
  { method: 'GET',    path: '/job-templates/:id/lines',       handler: listJobTemplateLines },
  { method: 'POST',   path: '/job-templates/:id/lines',       handler: createJobTemplateLine },
  { method: 'PATCH',  path: '/job-templates/:id/lines/:lid',  handler: patchJobTemplateLine },
  { method: 'DELETE', path: '/job-templates/:id/lines/:lid',  handler: deleteJobTemplateLine },

  // -------------------------------------------------------------------------
  // supply_plans (parent; FSM draft / released / fulfilled / cancelled)
  // -------------------------------------------------------------------------
  { method: 'GET',    path: '/supply-plans',           handler: listSupplyPlans },
  { method: 'POST',   path: '/supply-plans',           handler: createSupplyPlan },
  { method: 'GET',    path: '/supply-plans/:id',       handler: getSupplyPlan },
  { method: 'PATCH',  path: '/supply-plans/:id',       handler: patchSupplyPlan },
  { method: 'DELETE', path: '/supply-plans/:id',       handler: deleteSupplyPlan },
  { method: 'POST',   path: '/supply-plans/:id/release', handler: releaseSupplyPlan },
  { method: 'POST',   path: '/supply-plans/:id/cancel',  handler: cancelSupplyPlan },
  { method: 'POST',   path: '/supply-plans/:id/fulfill', handler: fulfillSupplyPlan },

  // supply_plan_lines (child; per-item demand resolution)
  { method: 'GET',    path: '/supply-plans/:id/lines',      handler: listSupplyPlanLines },
  { method: 'POST',   path: '/supply-plans/:id/lines',      handler: createSupplyPlanLine },
  { method: 'PATCH',  path: '/supply-plans/:id/lines/:lid', handler: patchSupplyPlanLine },
  { method: 'DELETE', path: '/supply-plans/:id/lines/:lid', handler: deleteSupplyPlanLine },

  // -------------------------------------------------------------------------
  // job_runs (parent; floor execution; FSM planned / in_progress / completed /
  // closed / cancelled)
  // -------------------------------------------------------------------------
  { method: 'GET',    path: '/job-runs',           handler: listJobRuns },
  { method: 'POST',   path: '/job-runs',           handler: createJobRun },
  { method: 'GET',    path: '/job-runs/:id',       handler: getJobRun },
  { method: 'PATCH',  path: '/job-runs/:id',       handler: patchJobRun },
  { method: 'DELETE', path: '/job-runs/:id',       handler: deleteJobRun },
  { method: 'POST',   path: '/job-runs/:id/start',    handler: startJobRun },
  { method: 'POST',   path: '/job-runs/:id/complete', handler: completeJobRun },
  { method: 'POST',   path: '/job-runs/:id/close',    handler: closeJobRun },
  { method: 'POST',   path: '/job-runs/:id/cancel',   handler: cancelJobRun },

  // job_run_daily_logs (child of job_runs; one day's work; FSM draft / posted)
  { method: 'GET',    path: '/job-runs/:id/daily-logs',          handler: listJobRunDailyLogs },
  { method: 'POST',   path: '/job-runs/:id/daily-logs',          handler: createJobRunDailyLog },
  { method: 'GET',    path: '/job-runs/:id/daily-logs/:lid',     handler: getJobRunDailyLog },
  { method: 'PATCH',  path: '/job-runs/:id/daily-logs/:lid',     handler: patchJobRunDailyLog },
  { method: 'DELETE', path: '/job-runs/:id/daily-logs/:lid',     handler: deleteJobRunDailyLog },
  { method: 'POST',   path: '/job-runs/:id/daily-logs/:lid/post', handler: postJobRunDailyLog },

  // job_run_daily_log consumed lines (item_id REQUIRED)
  { method: 'GET',    path: '/job-runs/:id/daily-logs/:lid/consumed-lines',      handler: listConsumedLines },
  { method: 'POST',   path: '/job-runs/:id/daily-logs/:lid/consumed-lines',      handler: createConsumedLine },
  { method: 'PATCH',  path: '/job-runs/:id/daily-logs/:lid/consumed-lines/:cid', handler: patchConsumedLine },
  { method: 'DELETE', path: '/job-runs/:id/daily-logs/:lid/consumed-lines/:cid', handler: deleteConsumedLine },

  // job_run_daily_log produced lines (item_id NULLABLE)
  { method: 'GET',    path: '/job-runs/:id/daily-logs/:lid/produced-lines',      handler: listProducedLines },
  { method: 'POST',   path: '/job-runs/:id/daily-logs/:lid/produced-lines',      handler: createProducedLine },
  { method: 'PATCH',  path: '/job-runs/:id/daily-logs/:lid/produced-lines/:pid', handler: patchProducedLine },
  { method: 'DELETE', path: '/job-runs/:id/daily-logs/:lid/produced-lines/:pid', handler: deleteProducedLine },

  // -------------------------------------------------------------------------
  // job build artifacts (ADR 0006 P2b): run-scoped labels / scope-of-work /
  // timeline / approval jacket. Reads RLS-only; writes reuse job_run.update.
  // -------------------------------------------------------------------------
  { method: 'GET',    path: '/job-runs/:id/labels',                 handler: listJobRunLabels },
  { method: 'POST',   path: '/job-runs/:id/labels',                 handler: createJobRunLabel },
  { method: 'PATCH',  path: '/job-runs/:id/labels/:labelId',        handler: patchJobRunLabel },
  { method: 'DELETE', path: '/job-runs/:id/labels/:labelId',        handler: deleteJobRunLabel },

  { method: 'GET',    path: '/job-runs/:id/sow-steps',              handler: listJobRunSowSteps },
  { method: 'POST',   path: '/job-runs/:id/sow-steps',              handler: createJobRunSowStep },
  { method: 'PATCH',  path: '/job-runs/:id/sow-steps/:stepId',      handler: patchJobRunSowStep },
  { method: 'DELETE', path: '/job-runs/:id/sow-steps/:stepId',      handler: deleteJobRunSowStep },

  { method: 'GET',    path: '/job-runs/:id/timeline',               handler: getJobRunTimeline },
  { method: 'PUT',    path: '/job-runs/:id/timeline',               handler: upsertJobRunTimeline },

  { method: 'GET',    path: '/job-runs/:id/jacket',                 handler: getJobRunJacket },
  { method: 'POST',   path: '/job-runs/:id/jacket',                 handler: ensureJobRunJacket },
  { method: 'POST',   path: '/job-runs/:id/jacket/transition',      handler: transitionJobRunJacket },

  // -------------------------------------------------------------------------
  // build-from-quote (ADR 0006 P2b-2): an approved quote becomes a buildable
  // job. Reuses the 3PL chain (convert -> supply plan -> job run -> receiving
  // order) and seeds the build artifacts so the run lands gated.
  // -------------------------------------------------------------------------
  { method: 'POST',   path: '/build-from-quote/:quoteId',           handler: buildJobFromQuote },

  // -------------------------------------------------------------------------
  // billing_reviews (parent; FSM draft / approved / invoiced / cancelled)
  // -------------------------------------------------------------------------
  { method: 'GET',    path: '/billing-reviews',          handler: listBillingReviews },
  { method: 'POST',   path: '/billing-reviews',          handler: createBillingReview },
  { method: 'GET',    path: '/billing-reviews/:id',      handler: getBillingReview },
  { method: 'PATCH',  path: '/billing-reviews/:id',      handler: patchBillingReview },
  { method: 'DELETE', path: '/billing-reviews/:id',      handler: deleteBillingReview },
  { method: 'POST',   path: '/billing-reviews/:id/approve', handler: approveBillingReview },
  { method: 'POST',   path: '/billing-reviews/:id/cancel',  handler: cancelBillingReview },

  // -------------------------------------------------------------------------
  // view_job_profitability (read-only view; Job Profitability, Phase A7)
  // -------------------------------------------------------------------------
  { method: 'GET',    path: '/profitability',           handler: listProfitability },
  { method: 'GET',    path: '/profitability/:jobRunId', handler: getProfitability },
];
